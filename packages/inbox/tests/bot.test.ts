/** attachInbox end to end: a real Bot over MockProvider projecting its traffic into an Inbox. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryKv } from '@botmesh/core'
import { createTestBot, type TestBot } from '@botmesh/core/testing'
import { Inbox, KvInboxStore, MemoryInboxStore, attachInbox, type InboxStore } from '../src/index.js'

let t: TestBot | undefined
afterEach(async () => {
  await t?.bot.stop()
  t = undefined
})

const stores: Array<[string, () => InboxStore]> = [
  ['MemoryInboxStore', () => new MemoryInboxStore()],
  ['KvInboxStore', () => new KvInboxStore(new MemoryKv())],
]

describe.each(stores)('attachInbox over %s', (_name, makeStore) => {
  it('counts every inbound message of a burst and of many chats, and never counts replies', async () => {
    t = await createTestBot()
    t.bot.onMessage(async (ctx) => { if (ctx.body === 'ping') await ctx.say('pong') })
    const inbox = new Inbox(makeStore())
    attachInbox(t.bot, inbox, { tenantId: 'acme' })

    const chats = Array.from({ length: 5 }, (_, i) => t!.dm(`user-${i}`))
    await Promise.all(chats.map(async (chat) => { for (let i = 0; i < 10; i++) await chat.send(`hola ${i}`) }))
    await t.chat.send('ping')
    await t.chat.expectReply('pong')

    await vi.waitFor(async () => {
      const list = await inbox.list('acme')
      expect(list).toHaveLength(6)
      for (const chat of chats) expect((await inbox.get('acme', chat.chatId))?.unread).toBe(10)
      // One inbound + one outbound projection.
      expect(await inbox.get('acme', t!.chat.chatId)).toMatchObject({ unread: 1, version: 2, status: 'open', handoff: false })
    })
    expect(await inbox.list('local')).toEqual([])
  })

  it('keeps agent changes when new traffic arrives and projects group chats by chat id', async () => {
    t = await createTestBot()
    const inbox = new Inbox(makeStore())
    attachInbox(t.bot, inbox, { tenantId: 'acme' })
    await t.chat.send('hola')
    const first = await vi.waitFor(async () => {
      const c = await inbox.get('acme', t!.chat.chatId)
      expect(c).toBeDefined()
      return c!
    })
    const assigned = await inbox.assign('acme', first.id, 'agent-7', first.version)
    await inbox.handoff('acme', assigned.id, true, assigned.version)
    await t.chat.send('¿hay alguien? 🙋')
    await vi.waitFor(async () => {
      expect(await inbox.get('acme', t!.chat.chatId)).toMatchObject({ unread: 2, assigneeId: 'agent-7', handoff: true })
    })

    const group = t.group('group-1', { as: 'alice' })
    await group.send('hi')
    await group.as('bob').send('hello')
    await vi.waitFor(async () => {
      expect(await inbox.get('acme', group.chatId)).toMatchObject({ unread: 2 })
    })
  })

  it('reports projection failures on the bot error event without blocking replies', async () => {
    t = await createTestBot()
    t.bot.onMessage(async (ctx) => { await ctx.say(`echo ${ctx.body}`) })
    const store = makeStore()
    const failing: InboxStore = Object.assign(Object.create(store) as InboxStore, {
      applyMessage: () => Promise.reject(new Error('backend down')),
    })
    const errors: unknown[] = []
    // The payload has the core's `'error'` event shape: `{ error, ctx? }`.
    t.bot.on('error', (payload) => { errors.push(payload.error) })
    attachInbox(t.bot, new Inbox(failing))
    await t.chat.send('a')
    await t.chat.expectReply('echo a')
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(2))
    expect(errors.every((e) => e instanceof Error && e.message === 'backend down')).toBe(true)
  })

  it('stops projecting after detach (listener and send hook both removed)', async () => {
    t = await createTestBot()
    t.bot.onMessage(async (ctx) => { await ctx.say('ok') })
    const inbox = new Inbox(makeStore())
    const detach = attachInbox(t.bot, inbox)
    await t.chat.send('one')
    await t.chat.expectReply('ok')
    await vi.waitFor(async () => expect((await inbox.get('local', t!.chat.chatId))?.version).toBe(2))
    detach()
    await t.chat.send('two')
    await t.chat.expectReply('ok')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await inbox.get('local', t.chat.chatId)).toMatchObject({ unread: 1, version: 2 })
  })
})

describe('attachInbox without an error listener', () => {
  it('never crashes the process when the projection fails', async () => {
    t = await createTestBot()
    t.bot.onMessage(async (ctx) => { await ctx.say('ok') })
    const failing = Object.assign(Object.create(new MemoryInboxStore()) as InboxStore, {
      applyMessage: () => Promise.reject(new Error('backend down')),
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      attachInbox(t.bot, new Inbox(failing))
      await t.chat.send('a')
      await t.chat.expectReply('ok')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
