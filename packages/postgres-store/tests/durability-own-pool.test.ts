/**
 * PostgresDurability with a pool it creates itself (`connectionString`, no `pool`).
 * Hermetic: 'pg' is mocked with an EventEmitter pool, so a test can emit the 'error'
 * node-postgres raises when the server drops an IDLE client (restart, failover,
 * pg_terminate_backend). Without a listener that error is an uncaught exception.
 */
import { describe, expect, it, vi } from 'vitest'
import { PostgresDurability, PostgresDurableKv } from '../src/index.js'

const { MockPool } = await vi.hoisted(async () => {
  // vi.mock is hoisted above the imports, so the class is built in vi.hoisted.
  const { EventEmitter: Emitter } = await import('node:events')
  class MockPool extends Emitter {
    static last: MockPool | undefined
    ended = false
    constructor(readonly config: unknown) {
      super()
      MockPool.last = this
    }
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return { rows: [], rowCount: 0 }
    }
    async end(): Promise<void> {
      this.ended = true
    }
  }
  return { MockPool }
})

vi.mock('pg', () => ({ Pool: MockPool }))

describe('PostgresDurability — own pool', () => {
  it('reports an idle-client error of its own pool to the logger instead of crashing the process', async () => {
    const error = vi.fn()
    const kv = new PostgresDurableKv({ connectionString: 'postgres://db/botwa', logger: { error } })
    await kv.start()
    const pool = MockPool.last!
    // EventEmitter throws an 'error' nobody listens to: that is what crashed the process.
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.stringMatching(/idle client/))
    await kv.stop()
    expect(pool.ended).toBe(true)
  })

  it('does not crash without a logger either', async () => {
    const backend = new PostgresDurability({ connectionString: 'postgres://db/botwa' })
    await backend.start()
    expect(() => MockPool.last!.emit('error', new Error('connection terminated'))).not.toThrow()
    await backend.stop()
  })

  it('leaves the error events of an injected pool to their owner', async () => {
    const pool = new MockPool({})
    const kv = new PostgresDurableKv({ pool: pool as never, logger: { error: vi.fn() } })
    await kv.start()
    expect(pool.listenerCount('error')).toBe(0)
    await kv.stop()
    expect(pool.ended).toBe(false)
  })
})
