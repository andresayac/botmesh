import { describe, expect, it } from 'vitest'
import { MemoryKv } from '@botmesh/core'
import { TicketDesk, TicketContentionError, durableKvTicketStorage, memoryTicketStorage, type TicketKeyValue } from '../src/index.js'

/** A storage whose reads yield to the event loop, so two desks really interleave. */
function slowShared(base: TicketKeyValue): TicketKeyValue {
  const pause = () => new Promise((r) => setTimeout(r, Math.random() * 3))
  return {
    async get(k) { await pause(); return base.get(k) },
    async set(k, v) { await pause(); return base.set(k, v) },
    async setIf(k, expected, v) { await pause(); return base.setIf!(k, expected, v) },
  }
}

describe('TicketDesk — several replicas over one shared storage', () => {
  it('memoryTicketStorage exposes an atomic setIf (compare by value)', async () => {
    const s = memoryTicketStorage()
    expect(await s.setIf!('k', undefined, 'a')).toBe(true)
    expect(await s.setIf!('k', undefined, 'b')).toBe(false)
    expect(await s.setIf!('k', 'x', 'b')).toBe(false)
    expect(await s.setIf!('k', 'a', 'b')).toBe(true)
    expect(await s.get('k')).toBe('b')
  })

  for (const [name, make] of [
    ['memoryTicketStorage', () => memoryTicketStorage()],
    ['durableKvTicketStorage', () => durableKvTicketStorage(new MemoryKv())],
  ] as const) {
    it(`${name}: concurrent creates on two desks never share an id and both stay listed`, async () => {
      const shared = slowShared(make())
      const a = new TicketDesk({ storage: shared, reuseOpen: false })
      const b = new TicketDesk({ storage: shared, reuseOpen: false })
      const made = await Promise.all([
        ...Array.from({ length: 8 }, (_, i) => a.create({ chatId: `a${i}`, subject: 'x' })),
        ...Array.from({ length: 8 }, (_, i) => b.create({ chatId: `b${i}`, subject: 'y' })),
      ])
      const ids = made.map((t) => t.id)
      expect(new Set(ids).size).toBe(16)
      expect([...ids].map(Number).sort((x, y) => x - y)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
      // Each replica sees the other's tickets (fresh reads in shared mode).
      expect((await a.list()).length).toBe(16)
      expect((await b.queue()).length).toBe(16)
      // A fresh desk (third replica / restart) loads every one from the index.
      const c = new TicketDesk({ storage: shared })
      expect((await c.list({ status: 'open' })).length).toBe(16)
    })
  }

  it('an update on one replica is visible on the other and concurrent updates do not lose writes', async () => {
    const shared = slowShared(memoryTicketStorage())
    const a = new TicketDesk({ storage: shared })
    const b = new TicketDesk({ storage: shared })
    const t = await a.create({ chatId: 'c', subject: 's' })
    await Promise.all([
      a.update(t.id, { meta: { a: 1 } }),
      b.update(t.id, { priority: 'urgent' }),
    ])
    const seen = await a.get(t.id)
    expect(seen?.priority).toBe('urgent')
    expect(seen?.meta).toEqual({ a: 1 })
    await b.close(t.id)
    expect((await a.get(t.id))?.status).toBe('closed')
    expect(await a.queue()).toEqual([])
  })

  it('reuseOpen sees the open ticket created by another replica', async () => {
    const shared = memoryTicketStorage()
    const a = new TicketDesk({ storage: shared })
    const b = new TicketDesk({ storage: shared })
    const first = await a.create({ chatId: 'c', subject: 's' })
    const again = await b.create({ chatId: 'c', subject: 's' })
    expect(again.created).toBe(false)
    expect(again.id).toBe(first.id)
  })

  it('gives up with TicketContentionError when every compare-and-set loses', async () => {
    const base = memoryTicketStorage()
    const storage: TicketKeyValue = { get: base.get, set: base.set, setIf: async () => false }
    const d = new TicketDesk({ storage, maxRetries: 3 })
    await expect(d.create({ chatId: 'c', subject: 's' })).rejects.toBeInstanceOf(TicketContentionError)
  })
})
