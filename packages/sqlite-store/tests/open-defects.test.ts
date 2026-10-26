/** Low-severity defects left open by the alpha exit review (docs/release-readiness.md). */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { StoredMessage } from '@botmesh/core'
import { SQLiteStore } from '../src/SQLiteStore.js'

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })
const tmpFile = () => { dir = mkdtempSync(join(tmpdir(), 'botwa-sqlite-defects-')); return join(dir, 'bot.db') }

const lone = String.fromCharCode(0xd800)
const replacement = String.fromCharCode(0xfffd)
const msg = (chatId: string, id: string, body = id): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: 1, type: 'text', body, fromMe: false,
})

describe('ill-formed UTF-16 keys never collide', () => {
  it('rejects a message id or chat id with a lone surrogate instead of storing it as U+FFFD', async () => {
    const store = new SQLiteStore({ file: ':memory:' })
    await store.saveMessage(msg('c', `a${replacement}`, 'first'))
    await expect(store.saveMessage(msg('c', `a${lone}`, 'second'))).rejects.toThrow(TypeError)
    await expect(store.saveMessage(msg(`c${lone}`, 'x'))).rejects.toThrow(TypeError)
    expect((await store.getMessage({ chatId: 'c', id: `a${replacement}` }))?.body).toBe('first')
    // A lookup with an ill-formed id finds nothing (it could not have been stored).
    expect(await store.getMessage({ chatId: 'c', id: `a${lone}` })).toBeUndefined()
    await store.stop()
  })

  it('rejects a cursor key or value with a lone surrogate', async () => {
    const store = new SQLiteStore({ file: ':memory:' })
    await store.setCursor(`k${replacement}`, 'v1')
    await expect(store.setCursor(`k${lone}`, 'v2')).rejects.toThrow(TypeError)
    await expect(store.setCursor('k2', `v${lone}`)).rejects.toThrow(TypeError)
    expect(await store.getCursor(`k${replacement}`)).toBe('v1')
    expect(await store.getCursor(`k${lone}`)).toBeUndefined()
    await store.stop()
  })
})

describe('schedules() / durability() on a stopped store', () => {
  it('reopen the database (and rebind the other backend) instead of failing on a closed connection', async () => {
    const store = new SQLiteStore({ file: tmpFile() })
    const durability = store.durability()
    await store.stop()
    const schedules = store.schedules()
    const rec = await schedules.register({ id: 'job', kind: 'interval', spec: '60000', nextRunAt: 10 }, 1)
    expect(rec.id).toBe('job')
    // The backend created before stop() works on the reopened connection too.
    expect(await durability.kv.insert('t', 'id', 'v', { due: null, done: null })).toBeDefined()
    await store.start() // no-op: already open
    expect((await schedules.get('job'))?.id).toBe('job')
    await store.stop()
  })
})
