/**
 * MysqlStore — persistent {@link IStore} backed by MySQL/MariaDB (mysql2).
 *
 * All state lives in seven small tables (names configurable via `tablePrefix`,
 * so apps/bots can share one database; `user_data` backs `ctx.user`). Message bodies, chats, contacts,
 * checkpoints and conversations are stored as JSON documents; `timestamp` is
 * a plain BIGINT so `getMessagesByChat(limit)` is an indexed
 * `ORDER BY timestamp DESC LIMIT ?` window, returned oldest→newest.
 *
 * The pool is injectable (`opts.pool`) so tests — and callers that own a
 * connection pool — never need a live MySQL server. When no pool is injected,
 * `start()` creates one (`mysql2/promise`.createPool) and provisions the
 * schema (`CREATE TABLE IF NOT EXISTS`), and `stop()` closes it.
 *
 * @example
 * ```ts
 * import { Bot } from '@botmesh/core'
 * import { BaileysProvider } from '@botmesh/baileys'
 * import { MysqlStore } from '@botmesh/mysql-store'
 *
 * const store = new MysqlStore({ uri: 'mysql://user:pass@localhost:3306/botwa' })
 * const bot = new Bot({
 *   provider: new BaileysProvider({ session: 'demo' }),
 *   store,
 * })
 * await store.start()
 * ```
 */

import type {
  AIMessage,
  FlowCheckpoint,
  IStore,
  LoggerLike,
  MessageRef,
  StoredChat,
  StoredContact,
  StoredMessage,
  UserId,
} from '@botmesh/core'
import type {
  UserDataEntry,
} from '@botmesh/core/spi'
import { legacyMessageKey, messageKey } from '@botmesh/core/spi'
import { MysqlUserData } from './userData.js'
import { toJson } from './json.js'
import { MysqlScheduleStore } from './schedules.js'
import { createMysqlPool, type MysqlPoolConfig } from './driver.js'

/**
 * A mysql2/promise pool (what `createPool` from `mysql2/promise` returns), typed
 * structurally so that no published declaration imports `mysql2`: a consumer needs no
 * particular copy of the driver. The store narrows it to {@link MysqlPoolLike} at the boundary
 * (the native query typings are a wide generic union).
 */
export interface NativeMysqlPool {
  query(...args: never[]): unknown
  getConnection(...args: never[]): unknown
  end(...args: never[]): unknown
}

/**
 * Result tuple shape returned by mysql2/promise `query()`: `[rows, fields]`.
 * Rows are plain objects (JSON columns come back already parsed by mysql2,
 * TEXT columns as strings).
 */
export type MysqlQueryResult = [rows: Array<Record<string, unknown>>, fields: unknown]

/**
 * Structural subset of a mysql2/promise pool used by {@link MysqlStore}.
 * Tests inject an in-memory fake (see tests/fakePool.ts); a real pool is
 * accepted through {@link MysqlStoreOptions.pool} via {@link NativeMysqlPool}.
 */
export interface MysqlPoolLike {
  query(sql: string, params?: readonly unknown[]): Promise<MysqlQueryResult>
  /**
   * Check out a dedicated connection (mysql2/promise `pool.getConnection()`).
   * Used for the short transactions that make `upsertChat`/`upsertContact`
   * atomic across processes.
   */
  getConnection(): Promise<MysqlConnectionLike>
  end(): Promise<unknown>
}

/** Structural subset of a mysql2/promise `PoolConnection` used by {@link MysqlStore}. */
export interface MysqlConnectionLike {
  query(sql: string, params?: readonly unknown[]): Promise<MysqlQueryResult>
  /** Return the connection to the pool. */
  release(): void
  /** Close the connection instead of returning it (used when ROLLBACK itself fails). */
  destroy?(): void
}

/** InnoDB deadlock victim (ER_LOCK_DEADLOCK): the transaction was rolled back and can be retried. */
const ER_LOCK_DEADLOCK = 1213
/** Bound on merge retries (deadlock victim, or the row deleted between ensure-insert and lock). */
const MAX_MERGE_ATTEMPTS = 10
/** Bound on re-running one auto-committed statement chosen as a deadlock victim. */
const MAX_STATEMENT_ATTEMPTS = 5

function isDeadlock(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { errno?: unknown }).errno === ER_LOCK_DEADLOCK
}

/**
 * True when the statement never reached the server: the pool handed out a connection the
 * server had already closed (MariaDB closes it after "packet bigger than max_allowed_packet")
 * and writing the statement to its socket failed. Running it again is running it once.
 */
function isUnsentStatement(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { syscall?: unknown }).syscall === 'write'
}

/**
 * Statements at least this large run on a connection of their own. A statement over the
 * server's `max_allowed_packet` (16 MiB on MariaDB, 64 MiB on MySQL; never below 1 MiB)
 * makes the server close the connection, and through `pool.query` that dead connection
 * went back to the pool and failed the next, unrelated statement.
 */
const LARGE_STATEMENT_BYTES = 1024 * 1024

/** UTF-8 size of a statement and its string/binary parameters (escaping not counted). */
function statementBytes(sql: string, params?: readonly unknown[]): number {
  let bytes = sql.length
  if (params) {
    for (const p of params) {
      if (typeof p === 'string') bytes += p.length > 256 ? Buffer.byteLength(p, 'utf8') : p.length
      else if (p instanceof Uint8Array) bytes += p.byteLength
    }
  }
  return bytes
}

/** Run one statement on a dedicated connection, closed (never pooled again) when it fails. */
async function queryOnOwnConnection(pool: MysqlPoolLike, sql: string, params?: readonly unknown[]): Promise<MysqlQueryResult> {
  const conn = await pool.getConnection()
  let result: MysqlQueryResult
  try {
    result = await conn.query(sql, params)
  } catch (err) {
    if (conn.destroy) conn.destroy()
    else conn.release()
    throw err
  }
  conn.release()
  return result
}

/** Byte limit of every key column (`VARBINARY(1024)`). */
const MAX_KEY_BYTES = 1024
/** MySQL names are at most 64 characters; the longest the store creates is `user_data_expires_idx` (21). */
const MAX_PREFIX_LENGTH = 64 - 'user_data_expires_idx'.length
const utf8Encoder = new TextEncoder()

/** Fail fast (nothing written) instead of the server's "Data too long for column". */
function checkKey(what: string, value: string): void {
  const bytes = utf8Encoder.encode(value).length
  if (bytes > MAX_KEY_BYTES) {
    throw new RangeError(`MysqlStore: ${what} is ${bytes} bytes in UTF-8; key columns hold at most ${MAX_KEY_BYTES} bytes`)
  }
}

/** Network failures reported while connecting: `start()` adds where it tried to connect. */
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'])

const URI_SHAPE = 'mysql://user:password@host:3306/database'

/**
 * Validate a connection URI without ever echoing it (it usually holds the password): Node's
 * `Invalid URL` error carries the whole input, which a logger would print.
 */
function checkUri(uri: string): void {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    throw new TypeError(
      `MysqlStore: \`uri\` is not a valid URL (expected ${URI_SHAPE}). ` +
        'Percent-encode reserved characters in the user name and password (# → %23, @ → %40, / → %2F, : → %3A).',
    )
  }
  if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') {
    throw new TypeError(`MysqlStore: \`uri\` must start with mysql:// (got the scheme ${JSON.stringify(url.protocol)}; expected ${URI_SHAPE})`)
  }
  if (url.hash !== '') {
    throw new TypeError('MysqlStore: `uri` contains "#", which ends the URL there. Percent-encode it (# → %23) in the user name or password.')
  }
  // The authority ends at the first '/' or '?': an unencoded one in the password still parses,
  // with the user name as the host, the start of the password as the port and the rest
  // (including the real '@host') as the database path or the query, which errors would print.
  if (url.pathname.includes('@') || url.search.includes('@')) {
    throw new TypeError(
      'MysqlStore: `uri` has an "@" after the host, so the user name or password holds an unencoded "/" or "?" ' +
        `(expected ${URI_SHAPE}). Percent-encode reserved characters in the user name and password ` +
        '(/ → %2F, ? → %3F, @ → %40, # → %23, : → %3A).',
    )
  }
}

/** Where a connection config points, for error messages: never the user or the password. */
function describeTarget(config: MysqlPoolConfig): string {
  const uri = typeof config === 'string' ? config : config.uri
  const base = uri !== undefined ? new URL(uri) : undefined
  const rest = typeof config === 'string' ? {} : config
  const host = rest.host ?? (base?.hostname || 'localhost')
  const port = rest.port ?? (base?.port || '3306')
  const database = rest.database ?? (base ? decodeURIComponent(base.pathname.slice(1)) : '')
  return `${host}:${port} (database ${JSON.stringify(database)})`
}

export interface MysqlStoreOptions {
  /**
   * MySQL connection URI (`mysql://user:password@host:3306/database`, reserved characters in
   * the user name and password percent-encoded). Default: 'mysql://localhost:3306/botwa'.
   * Ignored when `pool` is given. The host/port/user/password/database options override
   * the matching parts of the URI (`{ uri, password }` keeps the URI's host and database).
   * A malformed URI throws a `TypeError` from the constructor that never repeats the URI.
   */
  uri?: string
  /** Hostname: with or without `uri` (then the discrete options are the whole config). */
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  /** Prefix for every table the store creates. Default: ''. */
  tablePrefix?: string
  /**
   * Inject an existing mysql2/promise pool — a real pool or any
   * {@link MysqlPoolLike} (e.g. an in-memory fake, REQUIRED for hermetic tests).
   * The store then never creates or closes it — the caller owns the
   * lifecycle. Schema provisioning (`CREATE TABLE IF NOT EXISTS`) still runs
   * on `start()`.
   */
  pool?: MysqlPoolLike | NativeMysqlPool
  /**
   * Max messages retained per chat. When set, `saveMessage` prunes the oldest
   * rows (by timestamp) beyond the cap. Default: undefined = unbounded.
   * Must be a non-negative integer, else the constructor throws a `RangeError`.
   */
  maxMessagesPerChat?: number
  /**
   * Rows deleted per statement by `purgeExpiredUserData` (default 1000). The
   * purge loops until no expired row is left, so a huge backlog is removed in
   * short statements instead of one long delete that holds locks for its whole
   * duration. Must be a positive integer, else the constructor throws a
   * `RangeError`.
   */
  purgeBatchSize?: number
  /**
   * Receives lifecycle errors (pool close failure) and, through `warn` (falling
   * back to `error`), the legacy-schema notice `start()` emits for tables
   * created by an earlier version. Any {@link LoggerLike} (pino, `console`, the bot's
   * logger) fits; every method is optional.
   */
  logger?: Partial<LoggerLike>
}

/** JSON column reply from mysql2: parsed object OR raw string, depending on driver/column type. */
function fromJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

/** Key columns are VARBINARY (exact, byte-wise ids), which mysql2 returns as Buffers. */
/** `affectedRows` of a mysql2 ResultSetHeader (the rows slot of a DML reply). */
function affectedRows(header: unknown): number {
  const n = (header as { affectedRows?: unknown } | undefined)?.affectedRows
  return typeof n === 'number' ? n : 0
}

/**
 * Rows MATCHED by an UPDATE, read from the header's `info` ("Rows matched: 1  Changed: 0
 * Warnings: 0"): the one count that does not depend on the connection's FOUND_ROWS flag.
 */
function matchedRows(header: unknown): number {
  const info = (header as { info?: unknown } | undefined)?.info
  const m = typeof info === 'string' ? /Rows matched: (\d+)/.exec(info) : null
  return m ? Number(m[1]) : affectedRows(header)
}

/**
 * The BIGINT sort key for a message timestamp. `StoredMessage.timestamp` is any JS number,
 * but mysql2 renders NaN and ±Infinity as bare identifiers (ER_BAD_FIELD_ERROR) and a value
 * past the BIGINT range is rejected, so it is floored and clamped; NaN sorts as 0. The
 * exact value is kept in the JSON document (as PostgresStore does).
 */
function sortKey(timestamp: number): number {
  const n = Math.floor(Number(timestamp))
  if (Number.isNaN(n)) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(-Number.MAX_SAFE_INTEGER, n))
}

function fromKey(value: unknown): string {
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value)
}

export class MysqlStore implements IStore {
  private pool: MysqlPoolLike | null
  /** The own pool being created (the driver loads lazily), shared by concurrent `start()` calls. */
  private opening?: Promise<MysqlPoolLike>
  private ownsPool: boolean
  /** What `start()` hands to mysql2's `createPool` when the store creates its own pool. */
  private readonly connection: MysqlPoolConfig
  private readonly t: {
    messages: string
    chats: string
    contacts: string
    checkpoints: string
    conversations: string
    cursors: string
  }
  private readonly maxMessagesPerChat?: number
  private readonly logger?: Partial<LoggerLike>
  private readonly userData: MysqlUserData

  constructor(opts: MysqlStoreOptions = {}) {
    if (opts.maxMessagesPerChat != null && !(Number.isInteger(opts.maxMessagesPerChat) && opts.maxMessagesPerChat >= 0)) {
      throw new RangeError(`MysqlStore: maxMessagesPerChat must be a non-negative integer, got ${opts.maxMessagesPerChat}`)
    }
    if (opts.purgeBatchSize != null && !(Number.isInteger(opts.purgeBatchSize) && opts.purgeBatchSize > 0)) {
      throw new RangeError(`MysqlStore: purgeBatchSize must be a positive integer, got ${opts.purgeBatchSize}`)
    }
    // mysql2's pool typings are a wide generic union; the `query(sql, params)`
    // subset used here matches at runtime, so narrow at the boundary.
    this.pool = (opts.pool ?? null) as MysqlPoolLike | null
    this.ownsPool = !opts.pool
    this.maxMessagesPerChat = opts.maxMessagesPerChat
    if (opts.uri !== undefined && !opts.pool) checkUri(opts.uri)
    // Discrete options override the matching parts of `uri` (mysql2 merges `{ uri, ...rest }`),
    // so `{ uri: process.env.MYSQL_URL, password: secret }` keeps the URI's host and database.
    const discrete: Exclude<MysqlPoolConfig, string> = {}
    for (const key of ['host', 'port', 'user', 'password', 'database'] as const) {
      if (opts[key] != null) Object.assign(discrete, { [key]: opts[key] })
    }
    this.connection = Object.keys(discrete).length === 0
      ? (opts.uri ?? 'mysql://localhost:3306/botwa')
      : opts.uri !== undefined ? { uri: opts.uri, ...discrete } : discrete
    this.logger = opts.logger
    const p = opts.tablePrefix ?? ''
    if (!/^[A-Za-z0-9_]*$/.test(p)) {
      throw new Error(`MysqlStore: invalid tablePrefix ${JSON.stringify(p)} (only [A-Za-z0-9_] allowed)`)
    }
    if (p.length > MAX_PREFIX_LENGTH) {
      throw new RangeError(
        `MysqlStore: tablePrefix is ${p.length} characters; it can be at most ${MAX_PREFIX_LENGTH} characters ` +
          '(MySQL names are limited to 64 and the longest the store creates is `{prefix}user_data_expires_idx`)',
      )
    }
    this.t = {
      messages: `${p}messages`,
      chats: `${p}chats`,
      contacts: `${p}contacts`,
      checkpoints: `${p}checkpoints`,
      conversations: `${p}conversations`,
      cursors: `${p}cursors`,
    }
    this.userData = new MysqlUserData((sql, params) => this.query(sql, params), `${p}user_data`, opts.purgeBatchSize)
  }

  /**
   * All DB access funnels through here — SQL stays small, fixed and parameterized. Each
   * call is one auto-committed statement, so a deadlock victim (ER_LOCK_DEADLOCK: the server
   * rolled the statement back as a whole) is simply run again, a bounded number of times.
   * Concurrent saves and `maxMessagesPerChat` trims of one chat deadlock on MariaDB's gap locks.
   */
  private async query(sql: string, params?: readonly unknown[]): Promise<MysqlQueryResult> {
    let resent = false
    for (let attempt = 1; ; attempt++) {
      const pool = this.pool
      if (pool == null) {
        throw new Error('MysqlStore: pool is not available — call start() first')
      }
      try {
        return statementBytes(sql, params) >= LARGE_STATEMENT_BYTES
          ? await queryOnOwnConnection(pool, sql, params)
          : await pool.query(sql, params)
      } catch (err) {
        if (!resent && isUnsentStatement(err)) {
          resent = true // once: the pool has dropped the dead connection by now
          attempt--
          continue
        }
        if (!isDeadlock(err) || attempt >= MAX_STATEMENT_ATTEMPTS) throw err
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * attempt))
      }
    }
  }

  /**
   * `{ ...existing, ...patch }` on one JSON document (chats/contacts), atomic
   * across connections and processes — the exact MemoryStore semantics: a
   * shallow merge where nested values are replaced, `null` is kept and an
   * explicit `undefined` drops the key (it is not serialised).
   *
   * A plain read-then-write lets two concurrent partial upserts of the same
   * record lose one side's fields. Instead, on one dedicated connection:
   *
   *   START TRANSACTION; SELECT data ... FOR UPDATE   -- row lock
   *   UPDATE ... SET data = <merged in JS>; COMMIT
   *
   * so every writer merges over the latest committed document. When the row
   * does not exist yet there is nothing to lock: the transaction is rolled
   * back (releasing InnoDB's gap lock, so creators never deadlock each other)
   * and the row is created with `INSERT ... ON DUPLICATE KEY UPDATE id = id`,
   * a no-op if a concurrent writer created it first; the loop then merges
   * over whatever is there. JSON_MERGE_PATCH is deliberately not used: it
   * merges recursively and treats `null` as "delete", which is not shallow.
   * A deadlock victim (ER_LOCK_DEADLOCK) is retried, bounded.
   */
  private async mergeDocument(table: string, id: string, patch: object): Promise<void> {
    if (this.pool == null) {
      throw new Error('MysqlStore: pool is not available — call start() first')
    }
    const pool = this.pool
    const conn = await pool.getConnection()
    let reusable = true
    try {
      for (let attempt = 1; attempt <= MAX_MERGE_ATTEMPTS; attempt++) {
        let inTransaction = false
        try {
          await conn.query('START TRANSACTION')
          inTransaction = true
          const [rows] = await conn.query(`SELECT data FROM \`${table}\` WHERE id = ? FOR UPDATE`, [id])
          if (rows.length > 0) {
            const merged = { ...fromJson<object>(rows[0]?.data), ...patch }
            await conn.query(`UPDATE \`${table}\` SET data = ? WHERE id = ?`, [toJson(merged), id])
            await conn.query('COMMIT')
            return
          }
          await conn.query('ROLLBACK')
          inTransaction = false
        } catch (err) {
          if (inTransaction) {
            try {
              await conn.query('ROLLBACK')
            } catch {
              reusable = false // never hand a connection with an open transaction back to the pool
            }
          }
          if (reusable && isDeadlock(err) && attempt < MAX_MERGE_ATTEMPTS) continue
          throw err
        }
        await conn.query(`INSERT INTO \`${table}\` (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id`, [id, toJson(patch)])
      }
      throw new Error(`MysqlStore: could not upsert ${JSON.stringify(id)} into ${table} after ${MAX_MERGE_ATTEMPTS} attempts`)
    } finally {
      if (!reusable && conn.destroy) conn.destroy()
      else conn.release()
    }
  }

  /* Messages -------------------------------------------------------------- */

  /**
   * Upsert keyed by `messageKey(ref)`. A message without `ref.id` or `chatId`
   * is ignored, like MemoryStore: providers send `''` when they have no stable
   * id, and keying those would make them overwrite each other.
   */
  async saveMessage(msg: StoredMessage): Promise<void> {
    if (!msg.ref?.id || !msg.chatId) return
    checkKey('the message key (messageKey(ref))', messageKey(msg.ref))
    checkKey('the chat id', msg.chatId)
    await this.query(
      `INSERT INTO \`${this.t.messages}\` (id, chat_id, timestamp, msg) VALUES (?, ?, ?, ?) ` +
        'ON DUPLICATE KEY UPDATE chat_id = VALUES(chat_id), timestamp = VALUES(timestamp), msg = VALUES(msg)',
      [messageKey(msg.ref), msg.chatId, sortKey(msg.timestamp), toJson(msg)],
    )
    // Drop the copy an older version wrote under the legacy key (else the
    // message would be listed twice). No-op for ids without ':' or '%'.
    const legacy = legacyMessageKey(msg.ref)
    if (legacy !== messageKey(msg.ref)) await this.deleteMessageRows(msg.chatId, legacy, legacy, msg.ref)
    await this.trimChat(msg.chatId)
  }

  /**
   * Prune the oldest messages of a chat beyond `maxMessagesPerChat` (no-op when
   * unset). MySQL forbids referencing the DELETE target in a plain subquery, so
   * the keep-set is wrapped in a derived table.
   */
  private async trimChat(chatId: string): Promise<void> {
    if (this.maxMessagesPerChat == null) return
    const t = this.t.messages
    await this.query(
      `DELETE FROM \`${t}\` WHERE chat_id = ? AND id NOT IN ` +
        `(SELECT id FROM (SELECT id FROM \`${t}\` WHERE chat_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?) keep)`,
      [chatId, chatId, this.maxMessagesPerChat],
    )
  }

  async getMessage(ref: MessageRef): Promise<StoredMessage | undefined> {
    if (!ref.id || !ref.chatId) return undefined
    const key = messageKey(ref)
    const found = await this.messageRow(key, ref)
    if (found) return found
    // Rows written before keys were escaped (only differs when an id has ':' or '%').
    const legacy = legacyMessageKey(ref)
    return legacy === key ? undefined : this.messageRow(legacy, ref)
  }

  /**
   * The message stored under `key` when it IS `ref`. A legacy key alone may
   * belong to another chat, or be another message's escaped key, so the
   * payload's own ref is checked.
   */
  private async messageRow(key: string, ref: MessageRef): Promise<StoredMessage | undefined> {
    const [rows] = await this.query(`SELECT msg FROM \`${this.t.messages}\` WHERE id = ? AND chat_id = ?`, [key, ref.chatId])
    const msg = fromJson<StoredMessage>(rows[0]?.msg)
    return msg?.ref?.id === ref.id && msg?.ref?.chatId === ref.chatId ? msg : undefined
  }

  /**
   * Delete the rows of `chatId` stored under either key (the escaped one
   * and/or the legacy one) that hold THIS message: a legacy key can be another
   * message's escaped key (legacy 'c:%3A' of ('c', '%3A') is the key of ('c', ':')).
   */
  private async deleteMessageRows(chatId: string, key: string, legacy: string, ref: MessageRef): Promise<void> {
    await this.query(
      `DELETE FROM \`${this.t.messages}\` WHERE chat_id = ? AND id IN (?, ?) ` +
        "AND JSON_UNQUOTE(JSON_EXTRACT(msg, '$.ref.id')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(msg, '$.ref.chatId')) = ?",
      [chatId, key, legacy, ref.id, ref.chatId],
    )
  }

  async getMessagesByChat(chatId: string, limit = 50): Promise<StoredMessage[]> {
    // MemoryStore's window for ANY number: non-positive/NaN gives nothing, a
    // fraction rounds up, Infinity means everything. Raw, MySQL rejected a
    // negative or fractional LIMIT (and `Infinity`) as a syntax error.
    if (!(limit > 0)) return []
    const count = Number.isFinite(limit) ? Math.min(Math.ceil(limit), Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    // Timestamp ties break by id — the order trimChat keeps — so the window is
    // deterministic; InnoDB's secondary index already ends in the primary key.
    const [rows] = await this.query(
      `SELECT msg FROM \`${this.t.messages}\` WHERE chat_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?`,
      [chatId, count],
    )
    return rows
      .map((r) => fromJson<StoredMessage>(r.msg))
      .filter((m): m is StoredMessage => m != null)
      .reverse() // oldest -> newest
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this.deleteMessageRows(ref.chatId, messageKey(ref), legacyMessageKey(ref), ref)
  }

  /* Chats ----------------------------------------------------------------- */

  /** Shallow-merges over any existing record, atomically across processes (see {@link mergeDocument}). */
  async upsertChat(chat: StoredChat): Promise<void> {
    checkKey('the chat id', chat.id)
    await this.mergeDocument(this.t.chats, chat.id, chat)
  }
  async getChat(chatId: string): Promise<StoredChat | undefined> {
    const [rows] = await this.query(`SELECT data FROM \`${this.t.chats}\` WHERE id = ?`, [chatId])
    return fromJson<StoredChat>(rows[0]?.data)
  }
  async listChats(): Promise<StoredChat[]> {
    const [rows] = await this.query(`SELECT data FROM \`${this.t.chats}\``)
    return rows.map((r) => fromJson<StoredChat>(r.data)).filter((c): c is StoredChat => c != null)
  }
  /**
   * Removes the chat record AND purges its message log (consistent with MemoryStore).
   * Both go in ONE transaction on a dedicated connection,
   * so a failure (or a crash) in the middle leaves both in place. A deadlock victim is
   * retried, bounded.
   */
  async deleteChat(chatId: string): Promise<void> {
    if (this.pool == null) {
      throw new Error('MysqlStore: pool is not available — call start() first')
    }
    const conn = await this.pool.getConnection()
    let reusable = true
    try {
      for (let attempt = 1; ; attempt++) {
        let inTransaction = false
        try {
          await conn.query('START TRANSACTION')
          inTransaction = true
          await conn.query(`DELETE FROM \`${this.t.messages}\` WHERE chat_id = ?`, [chatId])
          await conn.query(`DELETE FROM \`${this.t.chats}\` WHERE id = ?`, [chatId])
          await conn.query('COMMIT')
          return
        } catch (err) {
          if (inTransaction) {
            try {
              await conn.query('ROLLBACK')
            } catch {
              reusable = false // never hand a connection with an open transaction back to the pool
            }
          }
          if (reusable && isDeadlock(err) && attempt < MAX_MERGE_ATTEMPTS) continue
          throw err
        }
      }
    } finally {
      if (!reusable && conn.destroy) conn.destroy()
      else conn.release()
    }
  }

  /* Contacts -------------------------------------------------------------- */

  /** Shallow-merges over any existing record, atomically across processes (see {@link mergeDocument}). */
  async upsertContact(contact: StoredContact): Promise<void> {
    checkKey('the contact id', contact.id)
    await this.mergeDocument(this.t.contacts, contact.id, contact)
  }
  async getContact(userId: string): Promise<StoredContact | undefined> {
    const [rows] = await this.query(`SELECT data FROM \`${this.t.contacts}\` WHERE id = ?`, [userId])
    return fromJson<StoredContact>(rows[0]?.data)
  }
  async listContacts(): Promise<StoredContact[]> {
    const [rows] = await this.query(`SELECT data FROM \`${this.t.contacts}\``)
    return rows.map((r) => fromJson<StoredContact>(r.data)).filter((c): c is StoredContact => c != null)
  }

  async deleteContact(userId: string): Promise<void> {
    await this.query(`DELETE FROM \`${this.t.contacts}\` WHERE id = ?`, [userId])
  }

  /* Delivery cursor ------------------------------------------------------- */

  async getCursor(key: string): Promise<string | undefined> {
    const [rows] = await this.query(`SELECT value FROM \`${this.t.cursors}\` WHERE \`key\` = ?`, [key])
    const value = rows[0]?.value
    return value == null ? undefined : String(value)
  }
  async setCursor(key: string, value: string): Promise<void> {
    checkKey('the cursor key', key)
    await this.query(
      `INSERT INTO \`${this.t.cursors}\` (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, value],
    )
  }

  /* Flow checkpoints ------------------------------------------------------ */

  async getCheckpoint(key: string): Promise<FlowCheckpoint | undefined> {
    const [rows] = await this.query(`SELECT cp FROM \`${this.t.checkpoints}\` WHERE \`key\` = ?`, [key])
    return fromJson<FlowCheckpoint>(rows[0]?.cp)
  }
  async setCheckpoint(key: string, cp: FlowCheckpoint): Promise<void> {
    checkKey('the checkpoint key', key)
    await this.query(
      `INSERT INTO \`${this.t.checkpoints}\` (\`key\`, cp) VALUES (?, ?) ON DUPLICATE KEY UPDATE cp = VALUES(cp)`,
      [key, toJson(cp)],
    )
  }
  async clearCheckpoint(key: string): Promise<void> {
    await this.query(`DELETE FROM \`${this.t.checkpoints}\` WHERE \`key\` = ?`, [key])
  }
  /**
   * Compare-and-set write (see `IStore.setCheckpointIf`), judged by the rows MATCHED of one
   * conditional statement (mysql2 connects with `FOUND_ROWS`, so `affectedRows` counts
   * matched rows too; the header's `info` is read for the honest count). Revision 0 first
   * tries `INSERT IGNORE` (exactly one concurrent writer inserts) and, when the row exists,
   * a conditional `UPDATE` that only matches a row whose JSON has no revision.
   */
  async setCheckpointIf(key: string, cp: FlowCheckpoint, expectedRevision: number): Promise<boolean> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new RangeError(`MysqlStore.setCheckpointIf: expectedRevision must be a non-negative integer, got ${String(expectedRevision)}`)
    }
    checkKey('the checkpoint key', key)
    const t = this.t.checkpoints
    const json = toJson(cp) // same sanitizing as setCheckpoint (lone surrogates)
    if (expectedRevision === 0) {
      const [inserted] = await this.query(`INSERT IGNORE INTO \`${t}\` (\`key\`, cp) VALUES (?, ?)`, [key, json])
      if (affectedRows(inserted) === 1) return true
      const [header] = await this.query(
        `UPDATE \`${t}\` SET cp = ? WHERE \`key\` = ? AND COALESCE(JSON_EXTRACT(cp, '$.revision'), 0) = 0`,
        [json, key],
      )
      return matchedRows(header) === 1
    }
    const [header] = await this.query(
      `UPDATE \`${t}\` SET cp = ? WHERE \`key\` = ? AND JSON_EXTRACT(cp, '$.revision') = ?`,
      [json, key, expectedRevision],
    )
    return matchedRows(header) === 1
  }
  async clearCheckpointIf(key: string, expectedRevision: number): Promise<boolean> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new RangeError(`MysqlStore.clearCheckpointIf: expectedRevision must be a non-negative integer, got ${String(expectedRevision)}`)
    }
    const t = this.t.checkpoints
    const [header] = await this.query(
      `DELETE FROM \`${t}\` WHERE \`key\` = ? AND COALESCE(JSON_EXTRACT(cp, '$.revision'), 0) = ?`,
      [key, expectedRevision],
    )
    if (affectedRows(header) === 1) return true
    const [rows] = await this.query(`SELECT cp FROM \`${t}\` WHERE \`key\` = ?`, [key])
    return rows.length === 0 // absent counts as cleared
  }
  async listCheckpoints(): Promise<Array<[string, FlowCheckpoint]>> {
    const [rows] = await this.query(`SELECT \`key\`, cp FROM \`${this.t.checkpoints}\``)
    return rows
      .map((r) => [fromKey(r.key), fromJson<FlowCheckpoint>(r.cp)] as [string, FlowCheckpoint | undefined])
      .filter((e): e is [string, FlowCheckpoint] => e[1] != null)
  }

  /* AI conversation history ----------------------------------------------- */

  async getConversation(key: string): Promise<AIMessage[] | undefined> {
    const [rows] = await this.query(`SELECT messages FROM \`${this.t.conversations}\` WHERE \`key\` = ?`, [key])
    return fromJson<AIMessage[]>(rows[0]?.messages)
  }
  async setConversation(key: string, messages: AIMessage[]): Promise<void> {
    checkKey('the conversation key', key)
    await this.query(
      `INSERT INTO \`${this.t.conversations}\` (\`key\`, messages) VALUES (?, ?) ON DUPLICATE KEY UPDATE messages = VALUES(messages)`,
      [key, toJson(messages)],
    )
  }
  async clearConversation(key: string): Promise<void> {
    await this.query(`DELETE FROM \`${this.t.conversations}\` WHERE \`key\` = ?`, [key])
  }

  /* User data (ctx.user) — table {prefix}user_data, lazy expiry + purge ---- */

  async getUserData(userId: UserId, namespace: string, key: string): Promise<UserDataEntry | undefined> {
    return this.userData.get(userId, namespace, key, Date.now())
  }
  /** Upsert one entry; rejects with a `TypeError` when `value` is not JSON-serialisable. */
  async setUserData(entry: UserDataEntry): Promise<void> {
    await this.userData.set(entry)
  }
  async deleteUserData(userId: UserId, namespace?: string, key?: string): Promise<void> {
    await this.userData.delete(userId, namespace, key)
  }
  async listUserData(userId: UserId, namespace?: string): Promise<UserDataEntry[]> {
    return this.userData.list(userId, namespace, Date.now())
  }
  /** Delete every expired user-data row (all users); resolves with the count. */
  async purgeExpiredUserData(now: number = Date.now()): Promise<number> {
    return this.userData.purge(now)
  }

  /* Durable scheduler ------------------------------------------------------- */

  private scheduleStore?: MysqlScheduleStore

  /**
   * The durable scheduler's store on this store's pool and `tablePrefix` (table
   * `{prefix}schedules`, created by its own `start()`, which the scheduler calls):
   * `new Bot({ store, scheduler: { store: store.schedules() } })`. Always the same
   * instance. Its calls fail with the "pool is not available" error until this store is
   * started (the bot starts its store before the scheduler).
   */
  schedules(): MysqlScheduleStore {
    return (this.scheduleStore ??= new MysqlScheduleStore({
      pool: {
        query: (sql: string, params?: readonly unknown[]) => this.query(sql, params),
        getConnection: () => {
          if (this.pool == null) throw new Error('MysqlStore: pool is not available — call start() first')
          return this.pool.getConnection()
        },
      },
      tablePrefix: this.t.messages.slice(0, -'messages'.length),
    }))
  }

  /* Lifecycle -------------------------------------------------------------- */

  async start(): Promise<void> {
    if (this.pool == null) {
      const opening = (this.opening ??= createMysqlPool(this.connection)
        // Narrow the native pool to the query/end subset used here.
        .then((pool) => pool as MysqlPoolLike)
        .finally(() => { this.opening = undefined }))
      const pool = await opening
      if (this.pool == null) {
        this.pool = pool
        this.ownsPool = true
      }
    }
    try {
      await this.migrate()
    } catch (err) {
      throw this.ownsPool ? this.connectError(err) : err
    }
  }

  /**
   * A refused or unreachable server, reported with where the store tried to connect (never
   * the credentials). mysql2 reports a refused `localhost` as an AggregateError with an
   * EMPTY message (Node tries ::1 and 127.0.0.1); the original stays the `cause` and its
   * `code`/`errno` are copied, so checks on `err.code` keep working.
   */
  private connectError(err: unknown): unknown {
    const e = err as { code?: unknown; errno?: unknown; message?: unknown; errors?: unknown } | null
    if (typeof e !== 'object' || e === null || typeof e.code !== 'string' || !CONNECT_ERRORS.has(e.code)) return err
    const target = describeTarget(this.connection)
    const details = Array.isArray(e.errors) && e.errors.length > 0
      ? e.errors.map((x) => String((x as { message?: unknown } | null)?.message ?? x)).join('; ')
      : String(e.message ?? '') || e.code
    const hint = target.startsWith('localhost:')
      ? ' On Windows with Docker, use 127.0.0.1 instead of localhost (localhost resolves to ::1 first).'
      : ''
    return Object.assign(
      new Error(`MysqlStore: cannot connect to MySQL at ${target}: ${e.code} (${details}). Is the server running and reachable?${hint}`, { cause: err }),
      { code: e.code, ...(e.errno !== undefined ? { errno: e.errno } : {}) },
    )
  }

  async stop(): Promise<void> {
    // A start() still creating the own pool: let it finish, then close that pool too.
    if (this.opening) await this.opening.catch(() => undefined)
    if (!this.ownsPool || this.pool == null) return
    const pool = this.pool
    this.pool = null // further calls fail fast with a clear error
    this.ownsPool = false
    try {
      await pool.end()
    } catch (err) {
      this.logger?.error?.({ err }, 'MysqlStore failed to close pool')
    }
  }

  /**
   * CREATE TABLE IF NOT EXISTS for the six state tables + user_data (idempotent).
   *
   * - Id/key columns are `VARBINARY(1024)`: ids are opaque strings and must
   *   compare byte-for-byte. A VARCHAR would inherit the server collation
   *   (utf8mb4_0900_ai_ci on MySQL 8 — case- and accent-insensitive, so 'abc'
   *   and 'ABC' would share one row), and the `_bin` collations are PAD SPACE
   *   ('k' = 'k '). 1024 bytes also fits long provider ids (base64 mids,
   *   composed keys) that overflowed the former VARCHAR(255).
   * - The secondary index `chat_ts (chat_id, timestamp)` serves
   *   getMessagesByChat's window, deleteChat and the maxMessagesPerChat trim.
   * - Explicit InnoDB/utf8mb4 so servers with other defaults (latin1, MyISAM)
   *   still get a working schema.
   *
   * Tables created by an older version keep their columns (IF NOT EXISTS
   * never alters); see the README for the manual upgrade.
   */
  private async migrate(): Promise<void> {
    const opts = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    await this.query(
      `CREATE TABLE IF NOT EXISTS \`${this.t.messages}\` (id VARBINARY(1024) NOT NULL PRIMARY KEY, ` +
        `chat_id VARBINARY(1024) NOT NULL, timestamp BIGINT, msg JSON, KEY chat_ts (chat_id, timestamp)) ${opts}`,
    )
    await this.query(`CREATE TABLE IF NOT EXISTS \`${this.t.chats}\` (id VARBINARY(1024) NOT NULL PRIMARY KEY, data JSON) ${opts}`)
    await this.query(`CREATE TABLE IF NOT EXISTS \`${this.t.contacts}\` (id VARBINARY(1024) NOT NULL PRIMARY KEY, data JSON) ${opts}`)
    await this.query(`CREATE TABLE IF NOT EXISTS \`${this.t.checkpoints}\` (\`key\` VARBINARY(1024) NOT NULL PRIMARY KEY, cp JSON) ${opts}`)
    await this.query(
      `CREATE TABLE IF NOT EXISTS \`${this.t.conversations}\` (\`key\` VARBINARY(1024) NOT NULL PRIMARY KEY, messages JSON) ${opts}`,
    )
    await this.query(`CREATE TABLE IF NOT EXISTS \`${this.t.cursors}\` (\`key\` VARBINARY(1024) NOT NULL PRIMARY KEY, value TEXT) ${opts}`)
    await this.userData.migrate()
    await this.checkLegacySchema()
  }

  /**
   * Warn (once per start) when a key column is not VARBINARY: tables created by
   * an early version kept `VARCHAR(255)` keys — collation-dependent comparisons
   * ('abc' = 'ABC'), a 255-character cap — and lack the `chat_ts` index, and
   * `CREATE TABLE IF NOT EXISTS` never upgrades them. Advisory only: the store
   * keeps working, and a failing check (no access to information_schema) is ignored.
   */
  private async checkLegacySchema(): Promise<void> {
    const keyColumns: Array<[table: string, column: string]> = [
      [this.t.messages, 'id'],
      [this.t.messages, 'chat_id'],
      [this.t.chats, 'id'],
      [this.t.contacts, 'id'],
      [this.t.checkpoints, 'key'],
      [this.t.conversations, 'key'],
      [this.t.cursors, 'key'],
    ]
    let rows: MysqlQueryResult[0]
    try {
      ;[rows] = await this.query(
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS type FROM information_schema.COLUMNS ' +
          'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?, ?, ?, ?)',
        Object.values(this.t),
      )
    } catch {
      return
    }
    const legacy = rows
      .map((r) => ({ table: fromKey(r.t), column: fromKey(r.c), type: fromKey(r.type).toLowerCase() }))
      .filter((r) => r.type !== 'varbinary' && keyColumns.some(([t, c]) => t === r.table && c === r.column))
    if (legacy.length === 0) return
    const columns = legacy.map((r) => `${r.table}.${r.column} (${r.type})`).join(', ')
    const log = this.logger?.warn ?? this.logger?.error
    log?.call(
      this.logger,
      { columns: legacy.map((r) => `${r.table}.${r.column}`) },
      `MysqlStore: tables created by an earlier version use non-binary key columns: ${columns}. ` +
        'Ids then compare case- and accent-insensitively and are capped at 255 characters, and the messages index is missing. ' +
        'Upgrade them with the ALTER TABLE statements in the @botmesh/mysql-store README ("Upgrading tables created by an earlier version").',
    )
  }
}
