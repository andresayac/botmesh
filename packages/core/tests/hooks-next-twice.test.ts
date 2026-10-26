/**
 * A before-hook that calls `next()` more than once keeps the FIRST dispatch (the message
 * is routed once, the send goes out once) and the misuse is reported on the bot `'error'`
 * event, instead of the old "next() called multiple times" rejection that dropped the message.
 */
import { describe, it, expect } from 'vitest'

import { HookSystem } from '../src/internal.js'
import { createTestBot } from '../src/testing/index.js'

describe('before-hook calling next() twice', () => {
  it('a message is dispatched once and the misuse is reported', async () => {
    const { bot, chat } = await createTestBot()
    const errors: unknown[] = []
    bot.on('error', ({ error }) => errors.push(error))
    let handled = 0
    bot.before('message', async (_ctx, next) => { await next(); await next() })
    bot.when('hi', async (ctx) => { handled++; await ctx.reply('hello') })
    await chat.send('hi')
    await chat.expectReply('hello')
    await expect.poll(() => errors.length).toBe(1)
    expect(handled).toBe(1)
    expect(String((errors[0] as Error).message)).toMatch(/before\('message'\) hook called next\(\) more than once/)
    await chat.expectNoReply({ timeout: 50 })
    await bot.stop()
  })

  it('a send goes out once', async () => {
    const { bot, chat, provider } = await createTestBot()
    const errors: unknown[] = []
    bot.on('error', ({ error }) => errors.push(error))
    bot.before('send', async (_payload, next) => { void next(); await next() })
    bot.when('hi', async (ctx) => { await ctx.reply('hello') })
    await chat.send('hi')
    await chat.expectReply('hello')
    await expect.poll(() => errors.length).toBe(1)
    expect(provider.outbox).toHaveLength(1)
    await bot.stop()
  })

  it('the second next() resolves with the first dispatch', async () => {
    const reported: unknown[] = []
    const hooks = new HookSystem(undefined, { report: (error) => reported.push(error) })
    const order: string[] = []
    hooks.register('message', 'before', async (_ctx: unknown, next: () => Promise<void>) => {
      const first = next()
      const second = next()
      await second
      order.push('second resolved')
      await first
    })
    hooks.register('message', 'before', async (_ctx: unknown, next: () => Promise<void>) => {
      await new Promise((r) => setTimeout(r, 20))
      order.push('inner done')
      await next()
    })
    const ok = await hooks.runBefore('message', { abort() {} })
    expect(ok).toBe(true)
    expect(order).toEqual(['inner done', 'second resolved'])
    expect(reported).toHaveLength(1)
  })
})
