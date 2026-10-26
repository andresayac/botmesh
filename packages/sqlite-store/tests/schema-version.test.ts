/**
 * Schema versioning: `PRAGMA user_version` records the layout a database was
 * written with. Opening runs the pending migrations in order (each in its own
 * IMMEDIATE transaction) and refuses a database written by a newer version.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { SQLiteStore, SQLiteSchemaVersionError, SQLITE_SCHEMA_VERSION } from '../src/index.js'
import { runMigrations, type SchemaMigration } from '../src/schema.js'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })
const tmpFile = () => { dir = mkdtempSync(join(tmpdir(), 'botmesh-sqlite-schema-')); return join(dir, 'bot.db') }

const userVersion = (file: string): number => {
  const db = new Database(file)
  try { return db.pragma('user_version', { simple: true }) as number } finally { db.close() }
}

/**
 * The layout written by the last released version (`@botmesh/sqlite-store@0.2.0-alpha.0`):
 * every table created with `IF NOT EXISTS`, no `user_version` (0).
 */
const RELEASED_0_2_0_ALPHA_0 = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_id TEXT,
    timestamp INTEGER NOT NULL, type TEXT NOT NULL, body TEXT,
    from_me INTEGER, msg_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, timestamp);
  CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, chat_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, contact_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS checkpoints (key TEXT PRIMARY KEY, checkpoint_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (key TEXT PRIMARY KEY, messages_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS user_data (
    user_id TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
    value_json TEXT NOT NULL, expires_at INTEGER, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, namespace, key)
  );
  CREATE INDEX IF NOT EXISTS idx_user_data_expires ON user_data (expires_at);
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, spec TEXT NOT NULL,
    next_run_at INTEGER, last_run_at INTEGER, last_status TEXT,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT, lease_until INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedule_fences (id TEXT PRIMARY KEY, token INTEGER NOT NULL);
`

function writeReleasedDb(file: string): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(RELEASED_0_2_0_ALPHA_0)
  const msg = { ref: { id: 'm1', chatId: 'c1' }, chatId: 'c1', senderId: 'u1', timestamp: 10, type: 'text', body: 'hello', fromMe: false }
  db.prepare('INSERT INTO messages (id, chat_id, sender_id, timestamp, type, body, from_me, msg_json) VALUES (?,?,?,?,?,?,?,?)')
    .run('c1:m1', 'c1', 'u1', 10, 'text', 'hello', 0, JSON.stringify(msg))
  db.prepare('INSERT INTO chats (id, chat_json) VALUES (?, ?)').run('c1', JSON.stringify({ id: 'c1', name: 'Chat' }))
  db.prepare('INSERT INTO checkpoints (key, checkpoint_json) VALUES (?, ?)')
    .run('c1:u1', JSON.stringify({ flow: 'signup', step: 2, state: { a: 1 }, updatedAt: 5 }))
  db.prepare('INSERT INTO user_data (user_id, namespace, key, value_json, expires_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('u1', 'prefs', 'lang', JSON.stringify('es'), null, 7)
  db.prepare('INSERT INTO schedules (id, kind, spec, next_run_at, fencing_token, updated_at) VALUES (?,?,?,?,?,?)')
    .run('daily', 'cron', '0 9 * * *', 1000, 3, 1)
  expect(db.pragma('user_version', { simple: true })).toBe(0)
  db.close()
}

describe('SQLiteStore schema versioning', () => {
  it('stamps a new database with the current schema version', async () => {
    const file = tmpFile()
    const store = new SQLiteStore({ file })
    await store.stop()
    expect(SQLITE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
    expect(userVersion(file)).toBe(SQLITE_SCHEMA_VERSION)
  })

  it('migrates a database written by the previous released layout and keeps its data', async () => {
    const file = tmpFile()
    writeReleasedDb(file)
    const store = new SQLiteStore({ file })
    await store.start()
    expect((await store.getMessage({ chatId: 'c1', id: 'm1' }))?.body).toBe('hello')
    expect((await store.getChat('c1'))?.name).toBe('Chat')
    expect((await store.getCheckpoint('c1:u1'))?.step).toBe(2)
    expect((await store.getUserData('u1', 'prefs', 'lang'))?.value).toBe('es')
    expect((await store.schedules().get('daily'))?.fencingToken).toBe(3)
    // Writes keep working on the migrated file.
    await store.saveMessage({ ref: { id: 'm2', chatId: 'c1' }, chatId: 'c1', senderId: 'u1', timestamp: 11, type: 'text', body: 'again', fromMe: false })
    expect((await store.getMessagesByChat('c1', 10)).map((m) => m.body)).toEqual(['hello', 'again'])
    await store.stop()
    expect(userVersion(file)).toBe(SQLITE_SCHEMA_VERSION)

    // Reopening an up-to-date database runs nothing and keeps the version.
    const again = new SQLiteStore({ file })
    expect((await again.getMessagesByChat('c1', 10))).toHaveLength(2)
    await again.stop()
    expect(userVersion(file)).toBe(SQLITE_SCHEMA_VERSION)
  })

  it('refuses a database written by a newer version, with a clear error, without touching it', () => {
    const file = tmpFile()
    new SQLiteStore({ file }).stop()
    const db = new Database(file)
    db.pragma(`user_version = ${SQLITE_SCHEMA_VERSION + 1}`)
    db.close()

    let error: unknown
    try { new SQLiteStore({ file }) } catch (err) { error = err }
    expect(error).toBeInstanceOf(SQLiteSchemaVersionError)
    const e = error as SQLiteSchemaVersionError
    expect(e.code).toBe('SQLITE_SCHEMA_TOO_NEW')
    expect(e.found).toBe(SQLITE_SCHEMA_VERSION + 1)
    expect(e.supported).toBe(SQLITE_SCHEMA_VERSION)
    expect(e.message).toMatch(/schema version/)
    expect(e.message).toMatch(/upgrade @botmesh\/sqlite-store/)
    expect(e.message).toContain(file)
    expect(userVersion(file)).toBe(SQLITE_SCHEMA_VERSION + 1)
    // The handle was released: the file can be removed (Windows keeps open files locked).
    rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('refuses a newer rollback-journal file before any persistent pragma (journal mode unchanged)', () => {
    const file = tmpFile()
    const db = new Database(file)
    db.pragma('journal_mode = DELETE')
    db.exec('CREATE TABLE future (x)')
    db.pragma(`user_version = ${SQLITE_SCHEMA_VERSION + 5}`)
    db.close()

    expect(() => new SQLiteStore({ file })).toThrow(SQLiteSchemaVersionError)
    const ro = new Database(file, { readonly: true })
    try {
      expect(ro.pragma('journal_mode', { simple: true })).toBe('delete')
      expect(ro.pragma('user_version', { simple: true })).toBe(SQLITE_SCHEMA_VERSION + 5)
    } finally { ro.close() }
    expect(existsSync(`${file}-wal`)).toBe(false)
    expect(existsSync(`${file}-shm`)).toBe(false)
  })

  it('runs pending migrations in order and rolls back a failing one (version and tables unchanged)', () => {
    const db = new Database(':memory:')
    const ran: number[] = []
    const migrations: SchemaMigration[] = [
      { version: 1, description: 'one', up: (d) => { ran.push(1); d.exec('CREATE TABLE a (x)') } },
      { version: 2, description: 'two', up: (d) => { ran.push(2); d.exec('CREATE TABLE b (x)') } },
    ]
    expect(runMigrations(db, migrations, ':memory:')).toEqual({ from: 0, to: 2 })
    expect(ran).toEqual([1, 2])
    expect(runMigrations(db, migrations, ':memory:')).toEqual({ from: 2, to: 2 })
    expect(ran).toEqual([1, 2])

    const failing: SchemaMigration[] = [
      ...migrations,
      { version: 3, description: 'three', up: (d) => { d.exec('CREATE TABLE c (x)'); throw new Error('boom') } },
    ]
    expect(() => runMigrations(db, failing, ':memory:')).toThrow(/migration 3 \(three\).*boom/)
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'c'").get()).toBeUndefined()
    db.close()
  })

  it('rejects a migration list that is not strictly increasing', () => {
    const db = new Database(':memory:')
    const bad: SchemaMigration[] = [
      { version: 2, description: 'two', up: () => {} },
      { version: 1, description: 'one', up: () => {} },
    ]
    expect(() => runMigrations(db, bad, ':memory:')).toThrow(/increasing/)
    db.close()
  })

  it('sets busy_timeout from busyTimeoutMs (default 5000) and validates it', async () => {
    const file = tmpFile()
    const store = new SQLiteStore({ file, busyTimeoutMs: 1234 })
    expect((store as unknown as { db: BetterSqlite3.Database }).db.pragma('busy_timeout', { simple: true })).toBe(1234)
    await store.stop()
    const byDefault = new SQLiteStore({ file })
    expect((byDefault as unknown as { db: BetterSqlite3.Database }).db.pragma('busy_timeout', { simple: true })).toBe(5000)
    await byDefault.stop()
    expect(() => new SQLiteStore({ file, busyTimeoutMs: -1 })).toThrow(RangeError)
    expect(() => new SQLiteStore({ file, busyTimeoutMs: 1.5 })).toThrow(RangeError)
  })
})
