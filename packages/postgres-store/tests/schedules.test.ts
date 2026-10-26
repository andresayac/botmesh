/**
 * PostgresScheduleStore against an in-memory fake pool (hermetic). The same contract runs
 * against a real server in schedules.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { type ScheduledRun } from '@botmesh/core'
import { Scheduler } from '@botmesh/core/internal'
import { PostgresStore } from '../src/PostgresStore.js'
import { PostgresScheduleStore } from '../src/schedules.js'
import { runScheduleStoreConformance } from '../../../test-utils/schedule-store-conformance.js'
import { FakeSchedulePool } from './fakeSchedulePool.js'
import { FakePool } from './fakePool.js'

runScheduleStoreConformance('PostgresScheduleStore (fake pool)', {
  async make() {
    const store = new PostgresScheduleStore({ pool: new FakeSchedulePool(), tablePrefix: 'bot_' })
    await store.start()
    return { store, teardown: async () => {} }
  },
})

describe('PostgresScheduleStore', () => {
  it('uses `{prefix}schedules` and rejects an unsafe prefix', () => {
    const pool = new FakeSchedulePool()
    expect(new PostgresScheduleStore({ pool }).table).toBe('schedules')
    expect(new PostgresScheduleStore({ pool, tablePrefix: 'bot_' }).table).toBe('bot_schedules')
    expect(() => new PostgresScheduleStore({ pool, tablePrefix: 'x; DROP TABLE y' })).toThrow(/invalid tablePrefix/)
    expect(() => new PostgresScheduleStore({ pool: {} as never })).toThrow(TypeError)
  })

  it('start() is idempotent and retries a lost catalog race', async () => {
    const pool = new FakeSchedulePool()
    const store = new PostgresScheduleStore({ pool })
    pool.failCreate = ['42P07', '23505']
    await store.start()
    await store.start()
    expect(pool.tables.has('schedules')).toBe(true)
    pool.failCreate = ['42501'] // insufficient privilege: not a race, surfaced
    await expect(store.start()).rejects.toMatchObject({ code: '42501' })
  })

  it('soft-deletes: the tombstone is invisible but keeps the fencing token', async () => {
    const pool = new FakeSchedulePool()
    const store = new PostgresScheduleStore({ pool })
    await store.start()
    await store.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 0 }, 0)
    await store.claimDue('t', 'a', 0, 1000)
    await store.delete('t')
    expect(pool.tables.get('schedules')!.get('t')).toMatchObject({ deleted: true, fencing_token: 1, lease_owner: null })
    expect(await store.list()).toEqual([])
  })

  it('sends whole milliseconds only (BIGINT rejects a fraction): deadlines round up, now rounds down', async () => {
    // Real PostgreSQL rejects `1500.5` for a BIGINT parameter (22P02), which made
    // `bot.every(1500.5, { id })`, a fractional leaseMs or a fractional clock fail every call.
    const fake = new FakeSchedulePool()
    const pool = {
      query(text: string, values: unknown[] = []) {
        const bad = values.find((v) => typeof v === 'number' && !Number.isInteger(v))
        if (bad !== undefined) return Promise.reject(Object.assign(new Error(`invalid input syntax for type bigint: "${bad}"`), { code: '22P02' }))
        return fake.query(text, values)
      },
    }
    const store = new PostgresScheduleStore({ pool })
    await store.start()
    expect(await store.register({ id: 't', kind: 'interval', spec: '1500.5', nextRunAt: 10.5 }, 0.5)).toMatchObject({ nextRunAt: 11, updatedAt: 0 })
    expect(await store.claimDue('t', 'a', 10.75, 1000)).toBeNull() // not due before the rounded-up slot
    const claim = await store.claimDue('t', 'a', 11.25, 1000.5)
    expect(claim?.record).toMatchObject({ nextRunAt: 11, leaseUntil: 1012, updatedAt: 11 })
    expect(await store.renew('t', claim!.fencingToken, 2000.1)).toBe(true)
    expect((await store.get('t'))?.leaseUntil).toBe(2001)
    expect(await store.complete('t', claim!.fencingToken, { nextRunAt: 3000.2, lastRunAt: 11.5, lastStatus: 'ok' }, 12.9)).toBe(true)
    expect(await store.get('t')).toMatchObject({ nextRunAt: 3001, lastRunAt: 12, updatedAt: 12 })
  })

  it('returns tokens past 2^31 as numbers', async () => {
    const pool = new FakeSchedulePool()
    const store = new PostgresScheduleStore({ pool })
    await store.start()
    pool.seed('schedules', { id: 'big', fencing_token: 2 ** 31 - 1 })
    const c = await store.claimDue('big', 'a', 1, 1000)
    expect(c?.fencingToken).toBe(2 ** 31)
    expect(typeof (await store.get('big'))?.fencingToken).toBe('number')
  })
})

describe('PostgresStore#schedules()', () => {
  it('returns one instance on the store pool and prefix, failing clearly before start()', async () => {
    const own = new PostgresStore({ tablePrefix: 'b1_' }) // would create its pool in start()
    const s = own.schedules()
    expect(own.schedules()).toBe(s)
    expect(s.table).toBe('b1_schedules')
    await expect(s.get('x')).rejects.toThrow(/not started/)
    await expect(s.start()).rejects.toThrow(/not started/)
  })

  it('shares the injected pool (once the store is started)', async () => {
    const pool = new FakeSchedulePool()
    // The fake only knows the schedule statements: the store's own DDL is a no-op here.
    const shared = {
      query: (text: string, values?: unknown[]) =>
        text.startsWith('CREATE') && !text.includes('schedules') ? Promise.resolve({ rows: [] }) : pool.query(text, values),
      end: async () => {},
    }
    const store = new PostgresStore({ pool: shared })
    const s = store.schedules()
    await expect(s.start()).rejects.toThrow(/not started/)
    await store.start()
    await s.start()
    await s.register({ id: 'x', kind: 'once', spec: '5', nextRunAt: 5 }, 0)
    expect(pool.tables.get('schedules')?.has('x')).toBe(true)
    expect(new PostgresStore({ pool: new FakePool() as never }).schedules().table).toBe('schedules')
  })

  it('works with the durable scheduler end to end', async () => {
    const pool = new FakeSchedulePool()
    const store = new PostgresScheduleStore({ pool })
    let now = 1_000_000
    const scheduler = new Scheduler({ store, now: () => now, tickMs: 10 })
    const runs: ScheduledRun[] = []
    scheduler.every(50, { id: 'beat' }, (run) => { runs.push(run) })
    await scheduler.start()
    expect(await store.get('beat')).toMatchObject({ nextRunAt: now + 50, fencingToken: 0 })
    now += 60
    await new Promise((r) => setTimeout(r, 80))
    await scheduler.stop()
    expect(runs.length).toBeGreaterThanOrEqual(1)
    expect(runs[0]).toMatchObject({ taskId: 'beat', fencingToken: 1 })
    expect((await store.get('beat'))?.lastStatus).toBe('ok')
  })
})
