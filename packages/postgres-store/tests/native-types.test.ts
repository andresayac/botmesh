/**
 * Type-level contract: a real node-postgres `Pool` is accepted wherever the package takes a
 * pool, although no published declaration names pg (checked by `pnpm typecheck`).
 */
import pg from 'pg'
import { describe, expect, it } from 'vitest'

import {
  PostgresDurability,
  PostgresScheduleStore,
  PostgresStore,
  type NativePostgresPool,
  type PostgresDurabilityOptions,
  type PostgresScheduleStoreOptions,
  type PostgresStoreOptions,
} from '../src/index.js'

describe('native pg types', () => {
  it('a pg.Pool fits every pool option', async () => {
    const pool = new pg.Pool({ connectionString: 'postgres://127.0.0.1:1/never-connected' })
    const native: NativePostgresPool = pool
    const storeOpts: PostgresStoreOptions = { pool }
    const durableOpts: PostgresDurabilityOptions = { pool }
    const scheduleOpts: PostgresScheduleStoreOptions = { pool }
    expect(new PostgresStore(storeOpts)).toBeInstanceOf(PostgresStore)
    expect(new PostgresDurability(durableOpts)).toBeInstanceOf(PostgresDurability)
    expect(new PostgresScheduleStore(scheduleOpts)).toBeInstanceOf(PostgresScheduleStore)
    expect(native).toBe(pool)
    await pool.end() // never connected: nothing to close
  })
})
