/**
 * bot.stop() must not close the store under the outbound ledger: a reply the provider
 * already accepted is recorded (chat upsert + message row) before `store.stop()` runs,
 * instead of failing with the store's "closed" error on the bot's 'error' event.
 */
import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/store/MemoryStore.js'
import { createTestBot } from '../src/testing/index.js'
import type { MessageRef, StoredChat, StoredMessage } from '../src/core/provider.js'

/** A store with slow reads that refuses every call once stopped, like a closed client/connection. */
class ClosingStore extends MemoryStore {
  closed = false
  readonly lateCalls: string[] = []
  private guard(name: string) { if (this.closed) { this.lateCalls.push(name); throw new Error('store is closed') } }
  override async start() { this.closed = false }
  override async stop() { this.closed = true }
  override async getMessage(ref: MessageRef) {
    await new Promise((r) => setTimeout(r, 20))
    this.guard('getMessage')
    return super.getMessage(ref)
  }
  override async saveMessage(msg: StoredMessage) { this.guard('saveMessage'); return super.saveMessage(msg) }
  override async upsertChat(chat: StoredChat) {
    await new Promise((r) => setTimeout(r, 20))
    this.guard('upsertChat')
    return super.upsertChat(chat)
  }
}

describe('bot.stop() and pending store writes', () => {
  it('records a reply the provider accepted before stopping the store', async () => {
    const store = new ClosingStore()
    const { bot, chat } = await createTestBot({ store })
    const errors: unknown[] = []
    bot.on('error', (e) => { errors.push(e) })
    bot.when('hi', (ctx) => ctx.reply('hello'))
    await chat.send('hi')
    await chat.expectReply('hello')
    await bot.stop()
    await new Promise((r) => setTimeout(r, 100)) // let any write still in flight hit the closed store
    expect(store.lateCalls).toEqual([])
    expect(errors).toEqual([])
    store.closed = false
    const [stored] = await store.listChats()
    const log = await store.getMessagesByChat(stored!.id, Infinity)
    expect(log.map((m) => m.body)).toEqual(['hi', 'hello'])
  })

  it('a hung after-send hook does not hang stop() forever', async () => {
    const store = new ClosingStore()
    const { bot, chat } = await createTestBot({ store })
    bot.after('send', () => new Promise<void>(() => {}))
    bot.when('hi', (ctx) => { void ctx.reply('hello').catch(() => {}) })
    await chat.send('hi')
    await chat.expectReply('hello')
    const started = Date.now()
    await bot.stop()
    expect(Date.now() - started).toBeLessThan(9_000)
  }, 15_000)
})
