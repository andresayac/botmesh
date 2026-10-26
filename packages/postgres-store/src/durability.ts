/**
 * PostgreSQL durability backend for `BotConfig.durability` (durable inbox/outbox).
 *
 * One table, `{prefix}durable`, holds both journals: each row is an opaque JSON document
 * with a version (compare-and-set) and two nullable sort keys (`due_at`, `done_at`).
 * Every state transition is computed by core's journal logic and committed with
 * `UPDATE … WHERE version = $n`, so any number of replicas can share the table: two
 * claimers can never both win a record, and a stale lease holder's completion is
 * rejected by its fencing token.
 *
 * @example
 * ```ts
 * import { Pool } from 'pg'
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 * const bot = new Bot({
 *   provider,
 *   store: new PostgresStore({ pool }),
 *   durability: { backend: new PostgresDurability({ pool }), instanceId: process.env.HOSTNAME },
 * })
 * ```
 */

import type { DurableKv, LoggerLike } from '@botmesh/core'
import { KvDurability, type DurableKvEntry, type DurableKvIndex, type DurableTable } from '@botmesh/core/spi'
import type { NativePostgresPool, PostgresPoolLike } from './PostgresStore.js'
import { createPgPool } from './driver.js'
import { assertTablePrefix } from './prefix.js'

export interface PostgresDurabilityOptions {
  /** An existing pool (shared with `PostgresStore`, or a fake in tests). The backend never ends it. */
  pool?: PostgresPoolLike | NativePostgresPool
  /** Used to create a pool when `pool` is not given. Default `postgres://localhost:5432/botwa`. */
  connectionString?: string
  /** Table-name prefix (plain SQL identifier prefix, at most 42 characters). Default `''` → table `durable`. */
  tablePrefix?: string
  /**
   * Receives the connection errors of idle clients of a pool this backend creates
   * (`connectionString`, no `pool`), which the pool replaces on the next query, and a
   * failure to end that pool on `stop()`.
   * An injected pool's 'error' events are the caller's to handle (node-postgres crashes
   * the process without a listener).
   */
  logger?: Partial<LoggerLike>
}

const CATALOG_RACE_CODES = new Set(['23505', '42P07', '42710'])
/** Largest BIGINT sort key we ever compare against (stands in for +∞). */
const MAX_KEY = Number.MAX_SAFE_INTEGER

function key(score: number | null): number | null {
  if (score === null) return null
  if (!Number.isFinite(score)) return score > 0 ? MAX_KEY : -MAX_KEY
  return Math.max(-MAX_KEY, Math.min(MAX_KEY, Math.floor(score)))
}

/** {@link DurableKv} over one PostgreSQL table. */
export class PostgresDurableKv implements DurableKv {
  private pool?: PostgresPoolLike
  /** The own pool being created (the driver loads lazily), shared by concurrent `start()` calls. */
  private opening?: Promise<PostgresPoolLike>
  /** The `start()` in progress, which `stop()` waits for (else it could not end the pool being opened). */
  private starting?: Promise<void>
  private started = false
  /**
   * The table exists on `pool`: set by the first `start()`. With an injected pool it stays
   * set after `stop()`: the scoped views of one backend (one per bot) and product stores
   * share this KV, and stopping one of them must not turn it off for the others.
   */
  private ready = false
  private readonly owned: boolean
  readonly table: string

  constructor(private readonly opts: PostgresDurabilityOptions = {}) {
    const prefix = opts.tablePrefix ?? ''
    assertTablePrefix('PostgresDurability', prefix)
    this.table = `${prefix}durable`
    this.pool = opts.pool as PostgresPoolLike | undefined
    this.owned = !opts.pool
  }

  /** The idempotent schema statements. */
  schemaStatements(): string[] {
    const t = this.table
    return [
      `CREATE TABLE IF NOT EXISTS ${t} (tbl TEXT NOT NULL, id TEXT NOT NULL, version BIGINT NOT NULL, due_at BIGINT, done_at BIGINT, doc TEXT NOT NULL, PRIMARY KEY (tbl, id))`,
      `CREATE INDEX IF NOT EXISTS ${t}_due_idx ON ${t} (tbl, due_at) WHERE due_at IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS ${t}_done_idx ON ${t} (tbl, done_at) WHERE done_at IS NOT NULL`,
    ]
  }

  /** Creates the pool (unless one was injected) and the table. Concurrent calls share one run. */
  async start(): Promise<void> {
    if (this.started) return
    return (this.starting ??= this.doStart().finally(() => { this.starting = undefined }))
  }

  private async doStart(): Promise<void> {
    if (!this.pool) this.pool = await (this.opening ??= this.createOwnPool().finally(() => { this.opening = undefined }))
    for (const statement of this.schemaStatements()) {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.pool.query(statement)
          break
        } catch (error) {
          // Replicas booting at once can lose a catalog race on CREATE … IF NOT EXISTS; the object exists by then.
          const code = String((error as { code?: unknown } | null)?.code)
          if (!CATALOG_RACE_CODES.has(code) || attempt >= 5) throw error
        }
      }
    }
    this.started = true
    this.ready = true
  }

  private async createOwnPool(): Promise<PostgresPoolLike> {
    const pool = await createPgPool(this.opts.connectionString ?? 'postgres://localhost:5432/botwa')
    // pg emits 'error' on the pool when an IDLE client loses its connection (server
    // restart, failover, pg_terminate_backend). With no listener that is an uncaught
    // exception that took the whole bot down; the pool already discards the dead client.
    if (typeof pool.on === 'function') {
      pool.on('error', (err: Error) => this.opts.logger?.error?.({ err }, 'PostgresDurability idle client error (the pool reconnects on the next query)'))
    }
    return pool
  }

  /**
   * Ends the pool only when this backend created it (a `start()` still in progress is
   * awaited first); an injected pool stays usable, so other bots sharing it keep working. A failure to end it goes to `logger.error`. It can be started again.
   */
  async stop(): Promise<void> {
    await this.starting?.catch(() => undefined)
    this.started = false
    if (!this.owned || !this.pool) return
    this.ready = false
    const pool = this.pool
    this.pool = undefined
    try {
      await pool.end()
    } catch (err) {
      this.opts.logger?.error?.({ err }, 'PostgresDurability failed to end pool')
    }
  }

  private q(text: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }> {
    // An injected pool exists from the constructor, but the table only after start().
    if (!this.pool || !this.ready) throw new Error('PostgresDurability is not started — the bot starts it (or call start())')
    return this.pool.query(text, values)
  }

  async get(tbl: DurableTable, id: string): Promise<DurableKvEntry | undefined> {
    const { rows } = await this.q(`SELECT doc, version FROM ${this.table} WHERE tbl = $1 AND id = $2`, [tbl, id])
    const row = rows[0] as { doc: string; version: string | number } | undefined
    return row ? { value: row.doc, version: String(row.version) } : undefined
  }

  async insert(tbl: DurableTable, id: string, value: string, index: DurableKvIndex): Promise<string | undefined> {
    const res = await this.q(
      `INSERT INTO ${this.table} (tbl, id, version, due_at, done_at, doc) VALUES ($1, $2, 1, $3, $4, $5) ON CONFLICT (tbl, id) DO NOTHING`,
      [tbl, id, key(index.due), key(index.done), value],
    )
    return res.rowCount === 1 ? '1' : undefined
  }

  async replace(tbl: DurableTable, id: string, version: string, value: string, index: DurableKvIndex): Promise<string | undefined> {
    const { rows } = await this.q(
      `UPDATE ${this.table} SET doc = $4, version = version + 1, due_at = $5, done_at = $6 WHERE tbl = $1 AND id = $2 AND version = $3 RETURNING version`,
      [tbl, id, version, value, key(index.due), key(index.done)],
    )
    const row = rows[0] as { version: string | number } | undefined
    return row ? String(row.version) : undefined
  }

  async remove(tbl: DurableTable, id: string, version: string): Promise<boolean> {
    const res = await this.q(`DELETE FROM ${this.table} WHERE tbl = $1 AND id = $2 AND version = $3`, [tbl, id, version])
    return res.rowCount === 1
  }

  async range(tbl: DurableTable, index: keyof DurableKvIndex, max: number, limit: number): Promise<string[]> {
    const col = index === 'due' ? 'due_at' : 'done_at'
    const { rows } = await this.q(
      `SELECT id FROM ${this.table} WHERE tbl = $1 AND ${col} IS NOT NULL AND ${col} <= $2 ORDER BY ${col}, id LIMIT $3`,
      [tbl, key(max), Math.max(0, Math.floor(limit))],
    )
    return (rows as Array<{ id: string }>).map((r) => r.id)
  }
}

/** PostgreSQL {@link DurabilityBackend} (see the module docs). */
export class PostgresDurability extends KvDurability {
  constructor(opts: PostgresDurabilityOptions = {}) { super(new PostgresDurableKv(opts)) }
}
