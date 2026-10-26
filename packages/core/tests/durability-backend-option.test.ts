/** `durability.backend` is the canonical name of the backend option; `journal` is its deprecated alias. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot, MemoryDurability, type BotConfig } from '../src/index.js'
import { MockProvider } from '../src/testing/index.js'

const bots: Bot[] = []
afterEach(async () => {
  for (const b of bots.splice(0)) await b.stop().catch(() => {})
})

function silent(): BotConfig['logger'] {
  const noop = () => {}
  const l = { debug: noop, info: noop, warn: noop, error: noop, child: () => l }
  return l
}

/** A backend without `scope()`, so the bot writes straight into `inner` (observable from the test). */
function unscoped() {
  const inner = new MemoryDurability()
  return { inner, backend: { inbox: inner.inbox, outbox: inner.outbox } }
}

describe('durability.backend', () => {
  it('uses the backend given as durability.backend', async () => {
    const { inner, backend } = unscoped()
    const provider = new MockProvider()
    const bot = new Bot({ provider, logger: silent(), durability: { backend } })
    bots.push(bot)
    await bot.start()
    bot.when('hi', (ctx) => ctx.reply('hello'))
    provider.incoming('hi', { from: 'u1', id: 'm1' })
    await vi.waitFor(async () => expect((await inner.inbox.list()).map((r) => r.state)).toEqual(['done']))
  })

  it('still accepts the deprecated durability.journal', async () => {
    const { inner, backend } = unscoped()
    const provider = new MockProvider()
    const bot = new Bot({ provider, logger: silent(), durability: { journal: backend } })
    bots.push(bot)
    await bot.start()
    bot.when('hi', (ctx) => ctx.reply('hello'))
    provider.incoming('hi', { from: 'u1', id: 'm1' })
    await vi.waitFor(async () => expect(await inner.inbox.list()).toHaveLength(1))
  })

  it('rejects two different backends under both names, naming both options', () => {
    const provider = new MockProvider()
    expect(() => new Bot({ provider, durability: { backend: new MemoryDurability(), journal: new MemoryDurability() } }))
      .toThrow(/durability\.backend.*durability\.journal|durability\.journal.*durability\.backend/)
    const same = new MemoryDurability()
    expect(() => new Bot({ provider, logger: silent(), durability: { backend: same, journal: same } })).not.toThrow()
  })

  it('names durability.backend when the value is not a backend', () => {
    const provider = new MockProvider()
    expect(() => new Bot({ provider, durability: { backend: {} as never } })).toThrow(/durability\.backend/)
    expect(() => new Bot({ provider, durability: { journal: {} as never } })).toThrow(/durability\.journal/)
  })
})
