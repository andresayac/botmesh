/**
 * `ctx` sends (reply/say/media, in handlers, flows and conversations) that hit a
 * `RateLimitedError` with a short `retryAfterMs` are retried in place: once by default,
 * waiting at most 5 s. `BotConfig.rateLimitRetry` tunes or disables it.
 */
import { describe, it, expect } from 'vitest'

import { ConfigValidationError, RateLimitedError, flow } from '../src/index.js'
import type { BotConfig } from '../src/index.js'
import { createTestBot } from '../src/testing/index.js'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function limited(times: number, retryAfterMs: number, config: Omit<BotConfig, 'provider'> = {}) {
  const t = await createTestBot(config)
  const errors: unknown[] = []
  t.bot.on('error', ({ error }) => errors.push(error))
  const base = t.provider.send.bind(t.provider)
  let left = times
  let calls = 0
  t.provider.send = async (chatId, content, options) => {
    calls++
    if (left > 0) { left--; throw new RateLimitedError(retryAfterMs) }
    return base(chatId, content, options)
  }
  return { ...t, errors, calls: () => calls }
}

describe('ctx sends retry a short rate limit', () => {
  it('a conversation c.say() is retried once and goes on', async () => {
    const { bot, chat, calls } = await limited(1, 20)
    bot.conversation('c', async (c) => { await c.say('one'); await c.say('two') }, { trigger: 'c' })
    await chat.send('c')
    await chat.expectReply('one')
    await chat.expectReply('two')
    expect(calls()).toBe(3)
    await bot.stop()
  })

  it('a flow media step is retried too', async () => {
    const { bot, chat, provider } = await limited(1, 20)
    bot.use(flow('pic').media('image', 'https://example.com/a.png', 'look'))
    await chat.send('pic')
    await expect.poll(() => provider.outbox.length).toBe(1)
    expect(provider.outbox[0]!.content.kind).toBe('image')
    await bot.stop()
  })

  it('by default only ONE retry: a second rate limit in a row fails the send', async () => {
    const { bot, chat, calls, errors } = await limited(2, 20)
    bot.when('hi', async (ctx) => { await ctx.reply('hello') })
    await chat.send('hi')
    await expect.poll(() => errors.length).toBe(1)
    expect(errors[0]).toBeInstanceOf(RateLimitedError)
    expect(calls()).toBe(2)
    await bot.stop()
  })

  it('rateLimitRetry.retries raises the number of retries', async () => {
    const { bot, chat, calls } = await limited(2, 20, { rateLimitRetry: { retries: 2 } })
    bot.when('hi', async (ctx) => { await ctx.reply('hello') })
    await chat.send('hi')
    await chat.expectReply('hello')
    expect(calls()).toBe(3)
    await bot.stop()
  })

  it('a retryAfterMs above maxWaitMs is not waited on', async () => {
    const { bot, chat, calls, errors } = await limited(1, 200, { rateLimitRetry: { maxWaitMs: '100ms' } })
    bot.when('hi', async (ctx) => { await ctx.reply('hello') })
    await chat.send('hi')
    await expect.poll(() => errors.length).toBe(1)
    expect(calls()).toBe(1)
    await bot.stop()
  })

  it('the default bound is 5 s', async () => {
    const { bot, chat, calls, errors } = await limited(1, 5_001)
    bot.when('hi', async (ctx) => { await ctx.reply('hello') })
    await chat.send('hi')
    await expect.poll(() => errors.length).toBe(1)
    expect(calls()).toBe(1)
    await bot.stop()
  })

  it('rateLimitRetry: false disables it', async () => {
    const { bot, chat, calls, errors } = await limited(1, 10, { rateLimitRetry: false })
    bot.when('hi', async (ctx) => { await ctx.reply('hello') })
    await chat.send('hi')
    await expect.poll(() => errors.length).toBe(1)
    await tick(30)
    expect(calls()).toBe(1)
    await bot.stop()
  })

  it('bot.send() is not retried (broadcasts and the outbox have their own policies)', async () => {
    const { bot, calls } = await limited(1, 10)
    await expect(bot.send('a@s', 'x')).rejects.toBeInstanceOf(RateLimitedError)
    expect(calls()).toBe(1)
    await bot.stop()
  })

  it('validates the option', async () => {
    await expect(createTestBot({ rateLimitRetry: { retries: -1 } })).rejects.toBeInstanceOf(ConfigValidationError)
    await expect(createTestBot({ rateLimitRetry: { maxWaitMs: 'soon' } })).rejects.toThrow(/rateLimitRetry\.maxWaitMs/)
    await expect(createTestBot({ rateLimitRetry: 3 as never })).rejects.toBeInstanceOf(ConfigValidationError)
  })
})
