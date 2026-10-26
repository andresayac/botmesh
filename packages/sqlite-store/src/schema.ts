/**
 * Schema versioning for SQLiteStore databases.
 *
 * `PRAGMA user_version` records the layout a file was written with. Opening a
 * database runs the pending {@link SchemaMigration}s in order, each in its own
 * `BEGIN IMMEDIATE` transaction together with the version bump, so a failure
 * leaves the file at the last completed version and two processes opening the
 * same file never run a step twice. A file stamped with a version newer than
 * this package knows is refused with {@link SQLiteSchemaVersionError} before
 * anything is written.
 *
 * Version 0 is every file written before versioning existed (up to
 * `@botmesh/sqlite-store@0.2.0-alpha.0`): its tables were all created with
 * `IF NOT EXISTS`, so the baseline migration (1) only adds what is missing.
 *
 * Version 2 adds the durable scheduler's tables (`schedules`, `schedule_fences`) and the
 * durability table (`durable` and its two partial indexes). Up to version 1 they were
 * created ad hoc by `schedules()` / `durability()` on first use, outside the version, so
 * the step is `IF NOT EXISTS` too: a file that already has them keeps its rows.
 */
/**
 * The part of a better-sqlite3 `Database` the migrations use. Structural so the
 * emitted declarations do not require `@types/better-sqlite3` in consumer projects.
 */
export interface SchemaDatabase {
  exec(sql: string): unknown
  pragma(source: string, options?: { simple?: boolean }): unknown
  transaction(fn: () => void): { immediate(): void }
}
import { DURABLE_SCHEMA } from './durability.js'
import { SCHEDULES_SCHEMA } from './schedules.js'
import { USER_DATA_SCHEMA } from './userData.js'

/** The tables of the store itself (messages, chats, contacts, checkpoints, conversations, cursors). */
const STORE_SCHEMA = `
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
`

/** One ordered schema step. `up` runs inside the migration's transaction. */
export interface SchemaMigration {
  version: number
  description: string
  up(db: SchemaDatabase): void
}

/**
 * Every schema step, in order. Append new steps; never edit or reorder a
 * released one (files in the field are already past it).
 */
export const MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    description: 'baseline: store tables and user_data',
    up: (db) => { db.exec(STORE_SCHEMA); db.exec(USER_DATA_SCHEMA) },
  },
  {
    version: 2,
    description: 'schedules, schedule_fences and durable tables',
    up: (db) => { db.exec(SCHEDULES_SCHEMA); db.exec(DURABLE_SCHEMA) },
  },
]

/**
 * The schema version this release of `@botmesh/sqlite-store` writes
 * (`PRAGMA user_version` of a file it opened). A file with a higher version was
 * written by a newer release and is refused.
 */
export const SQLITE_SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]!.version

/**
 * The database was written by a newer `@botmesh/sqlite-store` (its schema
 * version is above {@link SQLITE_SCHEMA_VERSION}). Nothing was written to it.
 */
export class SQLiteSchemaVersionError extends Error {
  readonly code = 'SQLITE_SCHEMA_TOO_NEW'
  constructor(readonly file: string, readonly found: number, readonly supported: number) {
    super(
      `SQLiteStore: "${file}" has schema version ${found}, but this @botmesh/sqlite-store supports up to ${supported}. ` +
        'It was written by a newer release: upgrade @botmesh/sqlite-store (downgrades are not supported; restore a backup ' +
        'taken before the upgrade to go back).',
    )
    this.name = 'SQLiteSchemaVersionError'
  }
}

const versionOf = (db: SchemaDatabase): number => Number(db.pragma('user_version', { simple: true }) ?? 0)

/**
 * Throw {@link SQLiteSchemaVersionError} when `db` was written by a newer version than
 * `migrations` knows. Only reads `PRAGMA user_version`, so it can run before any
 * persistent pragma (e.g. `journal_mode = WAL`) touches the file.
 */
export function assertSupportedVersion(db: SchemaDatabase, migrations: readonly SchemaMigration[], file: string): void {
  const latest = migrations.length ? migrations[migrations.length - 1]!.version : 0
  const found = versionOf(db)
  if (found > latest) throw new SQLiteSchemaVersionError(file, found, latest)
}

/**
 * Bring `db` to the last version of `migrations`. Returns the version found and
 * the version reached. Throws {@link SQLiteSchemaVersionError} for a newer file
 * and wraps a failing step (`cause` keeps the original error).
 */
export function runMigrations(
  db: SchemaDatabase,
  migrations: readonly SchemaMigration[],
  file: string,
): { from: number; to: number } {
  for (let i = 1; i < migrations.length; i++) {
    if (!(migrations[i]!.version > migrations[i - 1]!.version)) {
      throw new Error('SQLiteStore: schema migrations must have strictly increasing versions')
    }
  }
  const latest = migrations.length ? migrations[migrations.length - 1]!.version : 0
  const from = versionOf(db)
  if (from > latest) throw new SQLiteSchemaVersionError(file, from, latest)
  for (const step of migrations) {
    if (step.version <= from) continue
    const apply = db.transaction(() => {
      // Re-read under the write lock: another process may have run this step meanwhile.
      const current = versionOf(db)
      if (current > latest) throw new SQLiteSchemaVersionError(file, current, latest)
      if (current >= step.version) return
      step.up(db)
      db.pragma(`user_version = ${step.version}`)
    })
    try {
      apply.immediate()
    } catch (err) {
      if (err instanceof SQLiteSchemaVersionError) throw err
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`SQLiteStore: schema migration ${step.version} (${step.description}) failed on "${file}": ${detail}`, { cause: err })
    }
  }
  return { from, to: Math.max(from, latest) }
}
