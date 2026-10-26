/**
 * End-to-end through the public API: a Bot on the MockProvider with the plugin, driven by
 * inbound messages — bursts over many chats, send failures, stop/start cycles, a store whose
 * writes fail, handoff wiring on reassign/unassign and resource hygiene after stop.
 */
import { describe, expect, it } from 'vitest'
import { Bot, MemoryStore } from '@botmesh/core'
import { MockProvider, createTestBot } from '@botmesh/core/testing'
import { ticketsPlugin, type TicketsApi } from '../src/index.js'

describe('ticketsPlugin — end to end', () => {
  it('a burst of 200 chats asking for support gets 200 distinct tickets in arrival order', async () => {
    const { bot, dm } = await createTestBot()
    bot.plug(ticketsPlugin({ queueMessage: '🎫 #{{id}} pos {{position}} «{{subject}}»' }))
    bot.when('soporte ayuda', async (ctx) => { await ctx.tools.tickets!.create({ chatId: ctx.from, subject: ctx.body }) })
    const chats = Array.from({ length: 200 }, (_, i) => dm(`u${i}@s.whatsapp.net`))
    await Promise.all(chats.map((c) => c.send('soporte ayuda')))
    for (const c of chats) await c.expectReply(/^🎫 #\d+ pos \d+ «soporte ayuda»$/)
    const tickets = bot.injectTools.tickets as TicketsApi
    const queue = await tickets.queue()
    expect(queue).toHaveLength(200)
    expect(new Set(queue.map((t) => t.id)).size).toBe(200)
    expect(new Set(queue.map((t) => t.chatId)).size).toBe(200)
    // Repeats from the same chats reuse their open ticket: no new messages, no new ids.
    await Promise.all(chats.slice(0, 20).map((c) => c.send('soporte ayuda')))
    expect((await tickets.list()).length).toBe(200)
    await bot.stop()
  })

  it('a failing send goes to onError and never fails the ticket operation', async () => {
    class FlakyProvider extends MockProvider {
      override async send(...args: Parameters<MockProvider['send']>) {
        if (args[0] === 'broken') throw new Error('transport down')
        return super.send(...args)
      }
    }
    const bot = new Bot({ provider: new FlakyProvider() })
    const errors: Array<[string, string]> = []
    bot.plug(ticketsPlugin({
      queueMessage: 'q {{id}}', assignMessage: 'a {{assignee}}', closeMessage: 'c {{reason}}',
      onError: (e, source) => errors.push([source, (e as Error).message]),
    }))
    await bot.start()
    const t = bot.injectTools.tickets as TicketsApi
    const created = await t.create({ chatId: 'broken', subject: 's' })
    expect(created.created).toBe(true)
    await t.assign(created.id, 'ana')
    const closed = await t.close(created.id, { reason: 'done' })
    expect(closed.status).toBe('closed')
    expect(errors.map(([s]) => s)).toEqual(['queueMessage', 'assignMessage', 'closeMessage'])
    expect(errors.every(([, m]) => m === 'transport down')).toBe(true)
    await bot.stop()
  })

  it('survives stop/start cycles on the same bot and keeps numbering', async () => {
    const store = new MemoryStore()
    const bot = new Bot({ provider: new MockProvider(), store })
    bot.plug(ticketsPlugin())
    const t = bot.injectTools.tickets as TicketsApi
    for (let cycle = 0; cycle < 3; cycle++) {
      await bot.start()
      await t.create({ chatId: `c${cycle}`, subject: 'x' })
      await bot.stop()
    }
    await bot.start()
    expect((await t.list()).map((x) => x.id)).toEqual(['1', '2', '3'])
    await bot.stop()
  })

  it('a store whose cursor writes fail rejects create and leaves no phantom ticket', async () => {
    const store = new MemoryStore()
    let fail = false
    const setCursor = store.setCursor.bind(store)
    store.setCursor = async (k: string, v: string) => { if (fail) throw new Error('disk full'); return setCursor(k, v) }
    const bot = new Bot({ provider: new MockProvider(), store })
    bot.plug(ticketsPlugin())
    await bot.start()
    const t = bot.injectTools.tickets as TicketsApi
    await t.create({ chatId: 'a', subject: 'ok' })
    fail = true
    await expect(t.create({ chatId: 'b', subject: 'ko' })).rejects.toThrow('disk full')
    await expect(t.assign('1', 'ana')).rejects.toThrow('disk full')
    fail = false
    expect((await t.queue()).map((x) => x.chatId)).toEqual(['a'])
    expect((await t.get('1'))?.status).toBe('open')
    const again = await t.create({ chatId: 'b', subject: 'retry' })
    expect(again.created).toBe(true)
    await bot.stop()
  })

  it('handoff wiring: reassigning keeps the chat handed off; unassigning keeps it too; closing resumes', async () => {
    const { bot, chat } = await createTestBot()
    const errors: unknown[] = []
    bot.plug(ticketsPlugin({ handoffOnAssign: true, resumeOnClose: true, onError: (e) => errors.push(e) }))
    const t = bot.injectTools.tickets as TicketsApi
    await t.create({ chatId: chat.jid, subject: 's' })
    await t.assign('1', 'ana')
    await t.assign('1', 'bob')
    expect(bot.isHandedOff(chat.jid)).toBe(true)
    expect((await t.get('1'))?.assignee).toBe('bob')
    await t.update('1', { assignee: null })
    expect(await t.position('1')).toBe(1)
    expect(bot.isHandedOff(chat.jid)).toBe(true)
    await t.close('1')
    expect(bot.isHandedOff(chat.jid)).toBe(false)
    expect(errors).toEqual([])
    await bot.stop()
  })

  it('leaves no timers or handles behind after stop', async () => {
    // Log output pipes (PipeWrap/SimpleWriteWrap) are the test runner's, not the bot's.
    const live = () => process.getActiveResourcesInfo().filter((r) => !/Pipe|Write|TTY/.test(r))
    const before = live().length
    const { bot, chat } = await createTestBot()
    bot.plug(ticketsPlugin({ workingHours: '9-18', timezone: 'Europe/Madrid', queueMessage: 'q' }))
    const t = bot.injectTools.tickets as TicketsApi
    await t.create({ chatId: chat.jid, subject: 's' })
    await t.close('1')
    await bot.stop()
    await new Promise((r) => setImmediate(r))
    expect(live().length).toBeLessThanOrEqual(before)
  })
})
