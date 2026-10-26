import type { DurableKv, IStore } from '@botmesh/core'
import type { TicketKeyValue } from './types.js'

/**
 * In-memory {@link TicketKeyValue} (lost on restart). Handy for tests or ephemeral bots.
 * Its `setIf` is atomic, so several desks in one process can share it.
 */
export function memoryTicketStorage(): TicketKeyValue {
  const map = new Map<string, string>()
  return {
    async get(key) { return map.get(key) },
    async set(key, value) { map.set(key, value) },
    async setIf(key, expected, value) {
      if (map.get(key) !== expected) return false
      map.set(key, value)
      return true
    },
  }
}

/**
 * {@link TicketKeyValue} over the store's cursor API (`getCursor`/`setCursor`), which
 * all six bundled stores implement. Returns `undefined` when the store has no cursor
 * support, so the caller can fall back to memory. It has no compare-and-set, so it is
 * for a single bot process: for replicas use {@link durableKvTicketStorage}.
 */
export function storeTicketStorage(store: Pick<IStore, 'getCursor' | 'setCursor'>): TicketKeyValue | undefined {
  if (typeof store.getCursor !== 'function' || typeof store.setCursor !== 'function') return undefined
  return {
    get: (key) => store.getCursor!(key),
    set: (key, value) => store.setCursor!(key, value),
  }
}

/**
 * {@link TicketKeyValue} with compare-and-set over any `DurableKv` (`MemoryKv`,
 * `FileDurability`, the SQLite/PostgreSQL/Redis durability backends). Use it when
 * several bot replicas share the tickets: the desk then claims ids and edits the index
 * with compare-and-set, so ids never collide. Documents live in `table`
 * (default `'tickets'`); pass the same kv and table to every replica.
 */
export function durableKvTicketStorage(kv: DurableKv, table = 'tickets'): TicketKeyValue {
  if (typeof table !== 'string' || table === '') throw new Error('durableKvTicketStorage: table must be a non-empty string')
  const index = { due: null, done: null }
  return {
    async get(key) { return (await kv.get(table, key))?.value },
    async set(key, value) {
      for (;;) {
        const cur = await kv.get(table, key)
        const ok = cur ? await kv.replace(table, key, cur.version, value, index) : await kv.insert(table, key, value, index)
        if (ok !== undefined) return
      }
    },
    async setIf(key, expected, value) {
      const cur = await kv.get(table, key)
      if (cur?.value !== expected) return false
      const ok = cur ? await kv.replace(table, key, cur.version, value, index) : await kv.insert(table, key, value, index)
      return ok !== undefined
    },
  }
}
