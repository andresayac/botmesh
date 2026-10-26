/**
 * SQLiteStore lifecycle: the Bot calls store.stop() on bot.stop() and on a failed
 * start's rollback, and store.start() again on the next bot.start(). The store
 * (and the schedule/durability backends it handed out) must work again after that.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { StoredMessage } from '@botmesh/core'
import { createTestBot } from '@botmesh/core/testing'
import { SQLiteStore } from '../src/SQLiteStore.js'

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })
const tmpFile = () => { dir = mkdtempSync(join(tmpdir(), 'botwa-sqlite-life-')); return join(dir, 'bot.db') }

const msg = (chatId: string, id: string): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: 1, type: 'text', body: id, fromMe: false,
})

describe('SQLiteStore lifecycle', () => {
  it('reopens the database on start() after stop()', async () => {
    const store = new SQLiteStore({ file: tmpFile() })
    await store.start()
    await store.saveMessage(msg('c', 'm1'))
    await store.stop()
    await store.start()
    expect((await store.getMessage({ chatId: 'c', id: 'm1' }))?.body).toBe('m1')
    await store.saveMessage(msg('c', 'm2'))
    await store.upsertChat({ id: 'c', name: 'x' })
    await store.setUserData({ userId: 'u', namespace: 'n', key: 'k', value: 1, updatedAt: 1 })
    expect((await store.getUserData('u', 'n', 'k'))?.value).toBe(1)
    await store.stop()
  })

  it('start() and stop() are idempotent', async () => {
    const store = new SQLiteStore({ file: tmpFile() })
    await store.start()
    await store.start()
    await store.stop()
    await store.stop()
    await store.start()
    await store.setCursor('k', 'v')
    expect(await store.getCursor('k')).toBe('v')
    await store.stop()
  })

  it('the schedules() and durability() backends keep working after a restart', async () => {
    const store = new SQLiteStore({ file: tmpFile() })
    const schedules = store.schedules()
    const kv = store.durability().kv
    await schedules.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 10 }, 0)
    await kv.insert('inbox', 'a', '{}', { due: null, done: null })
    await store.stop()
    await store.start()
    expect(store.schedules()).toBe(schedules)
    expect((await schedules.get('t'))?.spec).toBe('1000')
    expect(await kv.get('inbox', 'a')).toMatchObject({ value: '{}' })
    expect(await schedules.claimDue('t', 'me', 20, 1000)).not.toBeNull()
    await store.stop()
  })

  it('a Bot survives stop() / start() cycles with the store (and a failed start)', async () => {
    const store = new SQLiteStore({ file: tmpFile() })
    const { bot, provider, chat } = await createTestBot({ store })
    bot.when('hi', (ctx) => ctx.reply('hello'))
    for (let i = 0; i < 3; i++) {
      await chat.send('hi')
      await chat.expectReply('hello')
      await bot.stop()
      await bot.start()
    }
    // A transport that fails to connect rolls the store back (stop); a retry starts it again.
    const connect = provider.start.bind(provider)
    provider.start = async () => { throw new Error('offline') }
    await bot.stop()
    await expect(bot.start()).rejects.toThrow('offline')
    provider.start = connect
    await bot.start()
    await chat.send('hi')
    await chat.expectReply('hello')
    const [stored] = await store.listChats()
    const log = await store.getMessagesByChat(stored!.id, Infinity)
    expect(log.filter((m) => m.body === 'hi')).toHaveLength(4)
    await bot.stop()
  })

  it.each([':memory:', ''])('an in-memory database (%j) keeps its data across stop() / start()', async (file) => {
    const store = new SQLiteStore({ file })
    const schedules = store.schedules()
    const kv = store.durability().kv
    await store.start()
    await store.setCursor('a', '1')
    await schedules.register({ id: 't', kind: 'interval', spec: '1000', nextRunAt: 10 }, 0)
    await kv.insert('inbox', 'a', '{}', { due: null, done: null })
    await store.stop()
    await store.start()
    expect(await store.getCursor('a')).toBe('1')
    expect((await schedules.get('t'))?.spec).toBe('1000')
    expect(await kv.get('inbox', 'a')).toMatchObject({ value: '{}' })
    await store.stop()
  })

  it('a Bot on an in-memory database keeps its chats across stop() / start() and a failed start', async () => {
    const store = new SQLiteStore({ file: ':memory:' })
    const { bot, provider, chat } = await createTestBot({ store })
    bot.when('hi', (ctx) => ctx.reply('hello'))
    await chat.send('hi')
    await chat.expectReply('hello')
    await bot.stop()
    await bot.start()
    expect(await store.listChats()).toHaveLength(1)
    const connect = provider.start.bind(provider)
    provider.start = async () => { throw new Error('offline') }
    await bot.stop()
    await expect(bot.start()).rejects.toThrow('offline')
    provider.start = connect
    await bot.start()
    const [stored] = await store.listChats()
    const log = await store.getMessagesByChat(stored!.id, Infinity)
    expect(log.map((m) => m.body)).toEqual(['hi', 'hello'])
    await bot.stop()
  })
})
