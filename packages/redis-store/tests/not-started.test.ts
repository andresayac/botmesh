/**
 * A store that creates (owns) its client used before `start()` (or after `stop()`)
 * failed with node-redis' bare "The client is closed". It now says what to do.
 * No server is contacted: the client is never connected.
 */
import { describe, expect, it } from 'vitest'
import { RedisStore } from '../src/RedisStore.js'

describe('RedisStore with its own client, not started', () => {
  it('rejects with an error that names start()', async () => {
    const store = new RedisStore({ url: 'redis://127.0.0.1:6390' })
    await expect(store.getCursor('k')).rejects.toThrow(/RedisStore.*start\(\)/)
    await expect(store.saveMessage({ ref: { id: 'm', chatId: 'c' }, chatId: 'c', senderId: 'c', timestamp: 1, type: 'text', body: 'x', fromMe: false })).rejects.toThrow(/start\(\)/)
    await expect(store.listChats()).rejects.toThrow(/start\(\)/)
    // stop() on a never-started store stays a no-op.
    await expect(store.stop()).resolves.toBeUndefined()
  })
})
