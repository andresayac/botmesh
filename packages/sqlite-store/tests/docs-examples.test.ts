/**
 * The examples of the README and of docs/guide/store.md (+ es), run as written (with
 * MockProvider in place of a real transport): a documented example that stops working
 * fails here.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Bot, flow } from '@botmesh/core'
import { MockProvider, createTestBot } from '@botmesh/core/testing'
import { SQLiteStore } from '../src/index.js'

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })
/** `./data/bot.db` of the examples, inside a temp directory (the examples assume ./data exists). */
function dataFile(): string {
  dir = mkdtempSync(join(tmpdir(), 'botwa-sqlite-docs-'))
  mkdirSync(join(dir, 'data'))
  return join(dir, 'data', 'bot.db')
}

describe('README / guide examples', () => {
  it('Usage with Bot: the bot starts and stops the store', async () => {
    const bot = new Bot({ provider: new MockProvider(), store: new SQLiteStore({ file: dataFile() }) })
    await bot.start()
    await bot.stop()
  })

  it('Durable scheduler tasks: store.schedules() keeps the next run across restarts', async () => {
    const file = dataFile()
    const boot = async () => {
      const store = new SQLiteStore({ file })
      const bot = new Bot({ provider: new MockProvider(), store, scheduler: { store: store.schedules() } })
      bot.schedule('0 9 * * *', { id: 'daily-report', missed: 'run-once' }, async () => { /* ... */ })
      await bot.start()
      return { bot, store }
    }
    const first = await boot()
    const [record] = await first.store.schedules().list()
    expect(record?.id).toMatch(/daily-report$/)
    expect(record?.nextRunAt).toBeGreaterThan(Date.now())
    await first.bot.stop()
    const second = await boot()
    expect((await second.store.schedules().list()).map((r) => r.nextRunAt)).toEqual([record!.nextRunAt])
    await second.bot.stop()
  })

  it('Durable message processing: store.durability() journals inbound messages', async () => {
    const store = new SQLiteStore({ file: dataFile() })
    const { bot, chat } = await createTestBot({ store, durability: { backend: store.durability() } })
    bot.when('hi', (ctx) => ctx.reply('hello'))
    await chat.send('hi')
    await chat.expectReply('hello')
    await bot.stop()
  })

  it('Persistent flows + SQLiteStore: a flow cut mid-way resumes after a restart', async () => {
    const file = dataFile()
    const registro = () => flow('registro')
      .persistent()
      .ask('¿Tu nombre?', 'name')
      .ask('¿Tu email?', 'email')
      .say((_ctx, c) => `✅ Registrado: ${String(c.state.name)}`)

    const first = await createTestBot({ store: new SQLiteStore({ file }) })
    first.bot.use(registro())
    await first.chat.send('registro')
    await first.chat.expectReply('¿Tu nombre?')
    await first.chat.send('Ana')
    await first.chat.expectReply('¿Tu email?')
    await first.bot.stop() // the process "crashes" while the flow waits for the email

    const second = await createTestBot({ store: new SQLiteStore({ file }) })
    second.bot.use(registro())
    await second.chat.send('hola')             // the next message wakes the saved flow…
    await second.chat.expectReply('¿Tu email?') // …which asks the pending question again
    await second.chat.send('ana@example.com')
    await second.chat.expectReply('✅ Registrado: Ana')
    await second.bot.stop()
  })
})
