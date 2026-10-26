/**
 * MysqlScheduleStore against an in-memory fake pool (hermetic). The same contract runs
 * against a real server in schedules.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { Scheduler, type ScheduledRun } from '@botmesh/core'
import { MysqlStore } from '../src/MysqlStore.js'
import { MysqlScheduleStore } from '../src/schedules.js'
import { runScheduleStoreConformance } from '../../../test-utils/schedule-store-conformance.js'
import { FakeSchedulePool, mysqlError } from './fakeSchedulePool.js'

const deadlock = () => mysqlError('ER_LOCK_DEADLOCK', 1213, 'Deadlock found when trying to get lock; try restarting transaction')

runScheduleStoreConformance('MysqlScheduleStore (fake pool)', {
  async make() {
    const pool = new FakeSchedulePool()
    const store = new MysqlScheduleStore({ pool, tablePrefix: 'bot_' })
    await store.start()
    return { store, teardown: async () => { expect(pool.open).toBe(0) } }
  },
})

runScheduleStoreConformance('MysqlScheduleStore (fake pool, no FOUND_ROWS, BIGINT strings)', {
  async make() {
    const store = new MysqlScheduleStore({ pool: new FakeSchedulePool({ foundRows: false, bigNumberStrings: true }) })
    await store.start()
    return { store, teardown: async () => {} }
  },
})

async function started(pool = new FakeSchedulePool()) {
  const store = new MysqlScheduleStore({ pool })
  await store.start()
  return { pool, store }
}

describe('MysqlScheduleStore', () => {
  it('stores whole milliseconds and returns exactly what it stored (fractional slots, leases and clocks)', async () => {
    // MySQL rounds a fractional BIGINT parameter; the returned record used to keep the
    // fraction, so it disagreed with the row (and with renew's exact lease_until check).
    const { pool, store } = await started(new FakeSchedulePool({ foundRows: false }))
    const params: unknown[][] = []
    const query = pool.query.bind(pool)
    pool.query = (sql: string, values?: readonly unknown[]) => { params.push([...(values ?? [])]); return query(sql, values) }
    expect(await store.register({ id: 't', kind: 'interval', spec: '1500.5', nextRunAt: 10.5 }, 0.5)).toMatchObject({ nextRunAt: 11, updatedAt: 0 })
    expect(await store.claimDue('t', 'a', 10.75, 1000)).toBeNull()
    const claim = await store.claimDue('t', 'a', 11.25, 1000.2)
    expect(claim?.record).toMatchObject({ nextRunAt: 11, leaseUntil: 1012, updatedAt: 11 })
    expect(await store.renew('t', claim!.fencingToken, 1011.4)).toBe(true) // rounds up to the stored 1012
    expect(await store.complete('t', claim!.fencingToken, { nextRunAt: 3000.2, lastRunAt: 11.5, lastStatus: 'ok' }, 12.9)).toBe(true)
    expect(await store.get('t')).toMatchObject({ nextRunAt: 3001, lastRunAt: 12, updatedAt: 12 })
    expect(params.flat().filter((v) => typeof v === 'number' && !Number.isInteger(v))).toEqual([])
  })

  it('validates the prefix and the pool', () => {
    const pool = new FakeSchedulePool()
    expect(new MysqlScheduleStore({ pool }).table).toBe('schedules')
    expect(new MysqlScheduleStore({ pool, tablePrefix: 'b_' }).table).toBe('b_schedules')
    expect(() => new MysqlScheduleStore({ pool, tablePrefix: 'a-b' })).toThrow(/invalid tablePrefix/)
    expect(() => new MysqlScheduleStore({ pool: { query() {} } as never })).toThrow(TypeError)
  })

  it('start() is idempotent', async () => {
    const { store, pool } = await started()
    await store.start()
    expect(pool.tables.has('schedules')).toBe(true)
  })

  it('retries a deadlocked claim and always releases the connection', async () => {
    const { store, pool } = await started()
    await store.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    pool.failNext(deadlock())
    pool.failNext(deadlock())
    expect((await store.claimDue('t', 'a', 0, 1000))?.fencingToken).toBe(1)
    expect(pool.open).toBe(0)
  })

  it('gives up after three deadlocks, releasing the connection', async () => {
    const { store, pool } = await started()
    await store.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    for (let i = 0; i < 3; i++) pool.failNext(deadlock())
    await expect(store.claimDue('t', 'a', 0, 1000)).rejects.toMatchObject({ errno: 1213 })
    expect(pool.open).toBe(0)
    expect(await store.claimDue('t', 'a', 0, 1000)).not.toBeNull()
  })

  it('does not retry other errors', async () => {
    const { store, pool } = await started()
    await store.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    pool.failNext(mysqlError('ER_LOCK_WAIT_TIMEOUT', 1205, 'Lock wait timeout exceeded'))
    await expect(store.claimDue('t', 'a', 0, 1000)).rejects.toMatchObject({ errno: 1205 })
    expect(pool.open).toBe(0)
  })

  it('serializes concurrent claims on the row lock (one winner)', async () => {
    const { store, pool } = await started()
    await store.register({ id: 'race', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.claimDue('race', `o${i}`, 1, 10_000)))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(pool.open).toBe(0)
  })

  it('fails fast (RangeError) on ids, specs and owners over the column limits', async () => {
    const { store } = await started()
    await expect(store.register({ id: 'é'.repeat(513), kind: 'interval', spec: '1', nextRunAt: 0 }, 0)).rejects.toThrow(RangeError)
    await expect(store.register({ id: 'ok', kind: 'cron', spec: 'x'.repeat(2049), nextRunAt: 0 }, 0)).rejects.toThrow(RangeError)
    await store.register({ id: 'x'.repeat(1024), kind: 'interval', spec: '1', nextRunAt: 0 }, 0)
    await expect(store.claimDue('ok', 'o'.repeat(513), 0, 1)).rejects.toThrow(RangeError)
  })

  it('decodes VARBINARY ids and returns tokens past 2^31 as numbers', async () => {
    const { store, pool } = await started(new FakeSchedulePool({ bigNumberStrings: true }))
    pool.seed('schedules', { id: 'big', fencing_token: 2 ** 31 - 1 })
    const c = await store.claimDue('big', 'a', 1, 1000)
    expect(c).toMatchObject({ fencingToken: 2 ** 31, record: { id: 'big', leaseOwner: 'a' } })
    expect(typeof (await store.list())[0].fencingToken).toBe('number')
  })

  it('soft-deletes, keeping the token in the tombstone', async () => {
    const { store, pool } = await started()
    await store.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    await store.claimDue('t', 'a', 0, 1000)
    await store.delete('t')
    expect(pool.tables.get('schedules')!.get('t')).toMatchObject({ deleted: 1, fencing_token: 1, lease_owner: null })
    expect(await store.get('t')).toBeNull()
  })
})

describe('MysqlStore#schedules()', () => {
  it('returns one instance on the store pool and prefix, failing clearly before start()', async () => {
    const own = new MysqlStore({ tablePrefix: 'b1_' })
    const s = own.schedules()
    expect(own.schedules()).toBe(s)
    expect(s.table).toBe('b1_schedules')
    await expect(s.get('x')).rejects.toThrow(/start\(\) first/)
    await expect(s.claimDue('x', 'a', 0, 1)).rejects.toThrow(/start\(\) first/)
  })

  it('shares the injected pool', async () => {
    const pool = new FakeSchedulePool()
    const store = new MysqlStore({ pool: pool as never, tablePrefix: 'p_' })
    const s = store.schedules()
    await s.start()
    await s.register({ id: 'x', kind: 'interval', spec: '5', nextRunAt: 0 }, 0)
    expect((await s.claimDue('x', 'a', 0, 10))?.fencingToken).toBe(1)
    expect(pool.tables.get('p_schedules')?.has('x')).toBe(true)
    expect(pool.open).toBe(0)
  })

  it('works with the durable scheduler end to end', async () => {
    const pool = new FakeSchedulePool()
    const store = new MysqlScheduleStore({ pool })
    let now = 1_000_000
    const scheduler = new Scheduler({ store, now: () => now, tickMs: 10 })
    const runs: ScheduledRun[] = []
    scheduler.every(50, { id: 'beat' }, (run) => { runs.push(run) })
    await scheduler.start()
    now += 60
    await new Promise((r) => setTimeout(r, 80))
    await scheduler.stop()
    expect(runs[0]).toMatchObject({ taskId: 'beat', fencingToken: 1 })
    expect((await store.get('beat'))?.lastStatus).toBe('ok')
  })
})
