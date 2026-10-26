import { describe, it, expect } from 'vitest'
import { createTestBot, MockProvider } from '../src/testing/index.js'
import { Bot, defineBot } from '../src/index.js'

describe('createTestBot(defineBot factory)', () => {
  it('builds the bot from a defineBot factory around the MockProvider and starts it', async () => {
    let seen: unknown
    const createBot = defineBot((provider) => {
      seen = provider
      const bot = new Bot({ provider })
      bot.when('hola', async (ctx) => { await ctx.reply('¡Hola! 👋') })
      return bot
    })
    const { bot, chat, provider } = await createTestBot(createBot)
    expect(provider).toBeInstanceOf(MockProvider)
    expect(seen).toBe(provider)
    await chat.send('hola')
    await chat.expectReply('¡Hola! 👋')
    await bot.stop()
  })

  it('accepts an async factory and provider options', async () => {
    const createBot = defineBot(async (provider) => {
      await Promise.resolve()
      const bot = new Bot({ provider })
      bot.when('x', async (ctx) => { await ctx.reply('y') })
      return bot
    })
    const { bot, chat, provider } = await createTestBot(createBot, { provider: { streaming: 'edit' } })
    expect(provider.capabilities.streaming).toBe('edit')
    await chat.send('x')
    await chat.expectReply('y')
    await bot.stop()
  })

  it('wraps the provider in chaos when asked', async () => {
    const createBot = defineBot((provider) => new Bot({ provider }))
    const { bot, chaos } = await createTestBot(createBot, { chaos: { seed: 1 } })
    expect(chaos).toBeDefined()
    await bot.stop()
  })

  it('rejects a factory that did not build its bot around the given provider', async () => {
    const other = new MockProvider()
    const createBot = defineBot(() => new Bot({ provider: other }))
    await expect(createTestBot(createBot)).rejects.toThrow(/provider/)
  })
})
