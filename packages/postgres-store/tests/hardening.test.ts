/**
 * Hardening found by the release test (beta): identifier length, start/stop races,
 * use before start() with an injected pool, and pool end failures of the durability
 * backend. Hermetic: 'pg' is mocked with an in-memory pool that records its instances.
 */
import { describe, expect, it, vi } from 'vitest'
import { PostgresDurability, PostgresDurableKv, PostgresScheduleStore, PostgresStore } from '../src/index.js'
import { FakePool } from './fakePool.js'

const { MockPool } = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class MockPool extends Emitter {
    static all: MockPool[] = []
    static failEnd = false
    ended = false
    constructor(readonly config: unknown) {
      super()
      MockPool.all.push(this)
    }
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      if (this.ended) throw new Error('Cannot use a pool after calling end on the pool')
      return { rows: [], rowCount: 0 }
    }
    async end(): Promise<void> {
      if (MockPool.failEnd) throw new Error('end failed')
      this.ended = true
    }
  }
  return { MockPool }
})

vi.mock('pg', () => ({ Pool: MockPool }))

describe('tablePrefix length (PostgreSQL truncates identifiers to 63 bytes)', () => {
  // A 61-character prefix made `chats` and `checkpoints` (and `contacts` and
  // `conversations`) truncate to the same table name: CREATE TABLE IF NOT EXISTS
  // then silently skipped the second one and both stores wrote into one table.
  const long = 'p' + 'x'.repeat(59) + '_'

  it('rejects a prefix that would make a table or index name exceed 63 bytes', () => {
    expect(() => new PostgresStore({ pool: new FakePool(), tablePrefix: long })).toThrow(/tablePrefix.*42/)
    expect(() => new PostgresScheduleStore({ pool: new FakePool(), tablePrefix: long })).toThrow(/tablePrefix.*42/)
    expect(() => new PostgresDurableKv({ pool: new FakePool(), tablePrefix: long })).toThrow(/tablePrefix.*42/)
    expect(() => new PostgresDurability({ pool: new FakePool(), tablePrefix: long })).toThrow(/tablePrefix.*42/)
  })

  it('accepts the longest prefix that keeps every name within the limit', () => {
    const max = 'a'.repeat(42)
    expect(() => new PostgresStore({ pool: new FakePool(), tablePrefix: max })).not.toThrow()
    expect(() => new PostgresScheduleStore({ pool: new FakePool(), tablePrefix: max })).not.toThrow()
    expect(() => new PostgresDurableKv({ pool: new FakePool(), tablePrefix: max })).not.toThrow()
    expect(() => new PostgresStore({ pool: new FakePool(), tablePrefix: max + 'b' })).toThrow(RangeError)
  })
})

describe('stop() while start() is still opening the own pool', () => {
  it('PostgresStore: ends the pool start() created and stays stopped', async () => {
    MockPool.all.length = 0
    const store = new PostgresStore({ connectionString: 'postgres://db/botwa' })
    const starting = store.start()
    await store.stop()
    await starting.catch(() => undefined)
    expect(MockPool.all).toHaveLength(1)
    expect(MockPool.all[0]!.ended).toBe(true)
    await expect(store.getCursor('k')).rejects.toThrow(/not started/)
    // And it can be started again afterwards.
    await store.start()
    expect(MockPool.all).toHaveLength(2)
    await expect(store.getCursor('k')).resolves.toBeUndefined()
    await store.stop()
    expect(MockPool.all[1]!.ended).toBe(true)
  })

  it('PostgresDurableKv: ends the pool start() created and stays stopped', async () => {
    MockPool.all.length = 0
    const kv = new PostgresDurableKv({ connectionString: 'postgres://db/botwa' })
    const starting = kv.start()
    await kv.stop()
    await starting.catch(() => undefined)
    expect(MockPool.all).toHaveLength(1)
    expect(MockPool.all[0]!.ended).toBe(true)
    await expect(kv.get('inbox', 'a')).rejects.toThrow(/not started/)
  })
})

describe('use before start()', () => {
  it('PostgresStore with an injected pool fails with the "call start()" error, not a missing-table error', async () => {
    const store = new PostgresStore({ pool: new FakePool() })
    await expect(store.getChat('c')).rejects.toThrow(/not started.*start\(\)/)
    await store.start()
    await expect(store.getChat('c')).resolves.toBeUndefined()
    await store.stop()
    await expect(store.getChat('c')).rejects.toThrow(/not started/)
  })

  it('PostgresDurableKv with an injected pool fails with the "not started" error', async () => {
    const kv = new PostgresDurableKv({ pool: new MockPool({}) as never })
    await expect(kv.get('inbox', 'a')).rejects.toThrow(/not started/)
    await kv.start()
    await expect(kv.get('inbox', 'a')).resolves.toBeUndefined()
  })
})

describe('PostgresDurableKv.stop()', () => {
  it('reports a failing pool end to the logger instead of rejecting (like PostgresStore)', async () => {
    const error = vi.fn()
    const kv = new PostgresDurableKv({ connectionString: 'postgres://db/botwa', logger: { error } })
    await kv.start()
    MockPool.failEnd = true
    try {
      await expect(kv.stop()).resolves.toBeUndefined()
    } finally {
      MockPool.failEnd = false
    }
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.stringMatching(/end pool/))
  })
})
