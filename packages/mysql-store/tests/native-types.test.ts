/**
 * Type-level contract: a real mysql2/promise pool is accepted wherever the package takes a
 * pool, although no published declaration names mysql2 (checked by `pnpm typecheck`).
 */
import { createPool } from 'mysql2/promise'
import { describe, expect, it } from 'vitest'

import {
  MysqlScheduleStore,
  MysqlStore,
  type MysqlScheduleStoreOptions,
  type MysqlStoreOptions,
  type NativeMysqlPool,
} from '../src/index.js'

describe('native mysql2 types', () => {
  it('a mysql2/promise Pool fits every pool option', async () => {
    const pool = createPool('mysql://127.0.0.1:1/never-connected') // lazy: connects on first query
    const native: NativeMysqlPool = pool
    const storeOpts: MysqlStoreOptions = { pool }
    const scheduleOpts: MysqlScheduleStoreOptions = { pool }
    expect(new MysqlStore(storeOpts)).toBeInstanceOf(MysqlStore)
    expect(new MysqlScheduleStore(scheduleOpts)).toBeInstanceOf(MysqlScheduleStore)
    expect(native).toBe(pool)
    await pool.end()
  })
})
