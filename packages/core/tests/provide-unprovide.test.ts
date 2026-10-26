import { describe, it, expect } from 'vitest'
import { createTestBot } from '../src/testing/index.js'
import { definePlugin } from '../src/index.js'

describe('bot.unprovide', () => {
  it('removes a provided tool and reports whether it existed', async () => {
    const { bot, chat } = await createTestBot()
    expect(bot.provide('db', { n: 1 }).provide('cache', 2)).toBe(bot)
    bot.when('t', async (ctx) => { await ctx.reply(Object.keys(ctx.tools).sort().join(',')) })
    await chat.send('t')
    await chat.expectReply('cache,db')
    expect(bot.unprovide('db')).toBe(true)
    expect(bot.unprovide('db')).toBe(false)
    expect('db' in bot.injectTools).toBe(false)
    await chat.send('t')
    await chat.expectReply('cache')
    await bot.stop()
  })

  it('lets a plugin undo its provide() in onDispose', async () => {
    const { bot } = await createTestBot()
    const unplug = bot.plug(definePlugin({
      name: 'svc',
      version: '1.0.0',
      install(ctx) {
        ctx.bot.provide('svc', 42)
        ctx.onDispose(() => { ctx.bot.unprovide('svc') })
      },
    }))
    expect(bot.injectTools.svc).toBe(42)
    unplug()
    expect('svc' in bot.injectTools).toBe(false)
    await bot.stop()
  })
})
