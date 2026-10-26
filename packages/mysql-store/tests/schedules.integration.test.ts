/**
 * MysqlScheduleStore against a REAL MySQL server (opt-in: skipped unless
 * BOTWA_TEST_MYSQL_URL is set; see integration.test.ts for the docker command).
 * Every store gets its own random table prefix; all of them are dropped afterwards.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise'
import { Bot, type ScheduledRun } from '@botmesh/core'
import { MockProvider } from '@botmesh/core/testing'
import { MysqlScheduleStore } from '../src/schedules.js'
import { MysqlStore } from '../src/MysqlStore.js'
import { runScheduleStoreConformance } from '../../../test-utils/schedule-store-conformance.js'

const URL = process.env.BOTWA_TEST_MYSQL_URL?.trim() ?? ''

describe.skipIf(!URL)('MysqlScheduleStore — real MySQL', () => {
  const run = `its${randomBytes(4).toString('hex')}_`
  let n = 0
  const pools: Pool[] = []
  const newPool = (extra: Partial<PoolOptions> = {}) => {
    const pool = createPool({ uri: URL, connectionLimit: 10, ...extra })
    pools.push(pool)
    return pool
  }
  const pool = URL ? newPool() : (undefined as unknown as Pool)
  const prefixes: string[] = []
  const freshPrefix = () => {
    const p = `${run}${n++}_`
    prefixes.push(p)
    return p
  }

  afterAll(async () => {
    for (const p of prefixes) await pool.query(`DROP TABLE IF EXISTS \`${p}schedules\``)
    for (const t of ['messages', 'chats', 'contacts', 'checkpoints', 'conversations', 'cursors', 'user_data']) {
      for (const p of prefixes) await pool.query(`DROP TABLE IF EXISTS \`${p}${t}\``)
    }
    for (const p of pools) await p.end()
  })

  runScheduleStoreConformance('MysqlScheduleStore (real)', {
    async make() {
      const store = new MysqlScheduleStore({ pool, tablePrefix: freshPrefix() })
      await store.start()
      return { store, teardown: async () => {} }
    },
  })

  runScheduleStoreConformance('MysqlScheduleStore (real, without FOUND_ROWS)', {
    async make() {
      const store = new MysqlScheduleStore({ pool: newPool({ flags: ['-FOUND_ROWS'], connectionLimit: 3 }), tablePrefix: freshPrefix() })
      await store.start()
      return { store, teardown: async () => {} }
    },
  })

  it('fractional milliseconds (every(1500.5), leaseMs 1000.2, a fractional clock) are stored as whole ms and stay consistent', async () => {
    const store = new MysqlScheduleStore({ pool: newPool({ flags: ['-FOUND_ROWS'], connectionLimit: 2 }), tablePrefix: freshPrefix() })
    await store.start()
    const rec = await store.register({ id: 'frac', kind: 'interval', spec: '1500.5', nextRunAt: 10.5 }, 0.5)
    expect(rec).toMatchObject({ nextRunAt: 11 })
    expect(await store.get('frac')).toMatchObject({ nextRunAt: 11 })
    const claim = await store.claimDue('frac', 'a', 11.25, 1000.2)
    expect(claim?.record).toMatchObject({ nextRunAt: 11, leaseUntil: 1012 })
    expect(await store.get('frac')).toEqual(claim!.record) // what the claim returns is what is stored
    expect(await store.renew('frac', claim!.fencingToken, claim!.record.leaseUntil!)).toBe(true) // same value: still held
    expect(await store.complete('frac', claim!.fencingToken, { nextRunAt: 3000.2, lastRunAt: 11, lastStatus: 'ok' }, 12.9)).toBe(true)
    expect(await store.get('frac')).toMatchObject({ nextRunAt: 3001, lastRunAt: 11 })
  })

  it('gives exactly one of 20 claimers on two pools of 2 connections the occurrence', async () => {
    const tablePrefix = freshPrefix()
    const a = new MysqlScheduleStore({ pool: newPool({ connectionLimit: 2 }), tablePrefix })
    const b = new MysqlScheduleStore({ pool: newPool({ connectionLimit: 2 }), tablePrefix })
    await a.start()
    await a.register({ id: 'race', kind: 'interval', spec: '1000', nextRunAt: 1000 }, 0)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).claimDue('race', `o${i}`, 2000, 60_000)),
    )
    const winners = results.filter((r) => r !== null)
    expect(winners).toHaveLength(1)
    expect(winners[0]!.fencingToken).toBe(1)
  })

  it('creates the schema from three instances at once', async () => {
    const tablePrefix = freshPrefix()
    const stores = [1, 2, 3].map(() => new MysqlScheduleStore({ pool: newPool({ connectionLimit: 2 }), tablePrefix }))
    await Promise.all(stores.map((s) => s.start()))
    await stores[0].register({ id: 'x', kind: 'once', spec: '5', nextRunAt: 5 }, 0)
    expect((await stores[2].get('x'))?.nextRunAt).toBe(5)
  })

  it('persists the schedule, token and lease across store instances', async () => {
    const tablePrefix = freshPrefix()
    const first = new MysqlScheduleStore({ pool, tablePrefix })
    await first.start()
    await first.register({ id: 'p', kind: 'cron', spec: 'TZ=Europe/Madrid 0 9 * * *', nextRunAt: 10 }, 0)
    await first.claimDue('p', 'a', 10, 5000)
    const second = new MysqlScheduleStore({ pool: newPool({ connectionLimit: 2 }), tablePrefix })
    await second.start()
    expect(await second.get('p')).toMatchObject({ spec: 'TZ=Europe/Madrid 0 9 * * *', nextRunAt: 10, fencingToken: 1, leaseOwner: 'a', leaseUntil: 5010 })
  })

  it('returns a fencing token past 2^31 as a number', async () => {
    const tablePrefix = freshPrefix()
    const store = new MysqlScheduleStore({ pool, tablePrefix })
    await store.start()
    await store.register({ id: 'big', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    await pool.query(`UPDATE \`${tablePrefix}schedules\` SET fencing_token = 2147483647 WHERE id = ?`, ['big'])
    const c = await store.claimDue('big', 'a', 1, 1000)
    expect(c?.fencingToken).toBe(2147483648)
    expect((await store.get('big'))?.fencingToken).toBe(2147483648)
  })

  it('MysqlStore#schedules() shares the store pool and prefix', async () => {
    const tablePrefix = freshPrefix()
    const store = new MysqlStore({ pool, tablePrefix })
    await store.start()
    const s = store.schedules()
    await s.start()
    await s.register({ id: 'shared', kind: 'interval', spec: '1000', nextRunAt: 1 }, 0)
    const [rows] = await pool.query(`SELECT id FROM \`${tablePrefix}schedules\``)
    expect((rows as Array<{ id: Buffer }>).map((r) => r.id.toString())).toEqual(['shared'])
  })

  it('two bots share an interval task: every occurrence runs once, and a restart keeps nextRunAt', async () => {
    const tablePrefix = freshPrefix()
    const keys: string[] = []
    const makeBot = () => {
      const schedules = new MysqlScheduleStore({ pool: newPool({ connectionLimit: 3 }), tablePrefix })
      const bot = new Bot({ provider: new MockProvider(), scheduler: { store: schedules, tickMs: 100 } })
      bot.every(300, { id: 'beat' }, (r: ScheduledRun) => { keys.push(r.occurrenceKey) })
      return { bot, schedules }
    }
    const a = makeBot()
    const b = makeBot()
    await Promise.all([a.bot.start(), b.bot.start()])
    await new Promise((r) => setTimeout(r, 2000))
    await b.bot.stop()
    const runs = keys.length
    expect(new Set(keys).size).toBe(runs)
    expect(runs).toBeGreaterThanOrEqual(5)
    await a.bot.stop()
    const stored = (await a.schedules.list()).find((r) => r.id.endsWith('beat'))!
    const c = makeBot()
    await c.bot.start()
    const after = (await c.schedules.list()).find((r) => r.id.endsWith('beat'))!
    // The restart keeps the stored slot grid instead of re-anchoring on its own start time.
    // On a loaded machine the restarted bot may already have run the next slot(s) when the
    // row is read, so the slot can be a whole number of intervals later, never off-grid.
    expect(after.nextRunAt! - stored.nextRunAt!).toBeGreaterThanOrEqual(0)
    expect((after.nextRunAt! - stored.nextRunAt!) % 300).toBe(0)
    expect(after.fencingToken).toBeGreaterThanOrEqual(stored.fencingToken)
    await c.bot.stop()
  })
})
