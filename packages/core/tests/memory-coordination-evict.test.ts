/**
 * `MemoryCoordinationHub` no longer keeps per-chat state forever: idle chats (no ticket,
 * no holder) are evicted beyond `maxIdleKeys`, least recently used first. Fences stay
 * monotonic per chat across an eviction, and a re-created chat reports `previousHolder:
 * null` ("unknown"), so the next holder refreshes its state.
 */
import { describe, it, expect } from 'vitest'

import { MemoryCoordinationHub, MemoryCoordinator } from '../src/index.js'

async function turn(c: MemoryCoordinator, key: string) {
  const t = await c.acquireTurn(await c.reserve(key))
  await t.release()
  return t
}

describe('MemoryCoordinationHub idle eviction', () => {
  it('keeps at most maxIdleKeys idle chats', async () => {
    const hub = new MemoryCoordinationHub({ maxIdleKeys: 2 })
    const c = new MemoryCoordinator({ hub, replicaId: 'r1' })
    await c.start()
    for (const key of ['a', 'b', 'c', 'd', 'e']) await turn(c, key)
    expect(hub.size).toBe(2)
    await c.stop()
  })

  it('never evicts a chat with a ticket or a holder', async () => {
    const hub = new MemoryCoordinationHub({ maxIdleKeys: 1 })
    const c = new MemoryCoordinator({ hub, replicaId: 'r1' })
    await c.start()
    const held = await c.acquireTurn(await c.reserve('held'))
    const queued = await c.reserve('held')
    for (const key of ['a', 'b', 'c']) await turn(c, key)
    expect(hub.size).toBe(2) // 'held' + one idle chat
    await held.release()
    const next = await c.acquireTurn(queued)
    expect(next.fence).toBe(held.fence + 1)
    await next.release()
    await c.stop()
  })

  it('fences stay monotonic across an eviction; previousHolder becomes unknown', async () => {
    const hub = new MemoryCoordinationHub({ maxIdleKeys: 1 })
    const c = new MemoryCoordinator({ hub, replicaId: 'r1' })
    await c.start()
    const first = await turn(c, 'a')
    const again = await turn(c, 'a')
    expect(again.previousHolder).toBe('r1')
    await turn(c, 'b') // evicts 'a'
    const after = await turn(c, 'a')
    expect(after.fence).toBeGreaterThan(again.fence)
    expect(again.fence).toBeGreaterThan(first.fence)
    expect(after.previousHolder).toBeNull()
    await c.stop()
  })

  it('defaults to a bound (10,000 idle chats)', () => {
    expect(new MemoryCoordinationHub().maxIdleKeys).toBe(10_000)
    expect(() => new MemoryCoordinationHub({ maxIdleKeys: -1 })).toThrow(/maxIdleKeys/)
  })
})
