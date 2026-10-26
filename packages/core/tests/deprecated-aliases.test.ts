/**
 * The `@deprecated` aliases kept until v3 still behave exactly like the canonical API they
 * point to. Aliases already exercised elsewhere (`ctx.say/answer/text`, `addKeyword`,
 * `bot.sendText/sendTo`, `bot.triggerFlow`, `bot.enterConversation`, `onImage`,
 * `durability.journal`, `storeConfig`, broadcast `maxRetries`) are not repeated here.
 */
import { describe, it, expect, vi } from 'vitest'
import { flow, type MessageType } from '../src/index.js'
import { createTestBot } from '../src/testing/createTestBot.js'

describe('deprecated aliases', () => {
  it.each([
    ['onAudio', 'audio'],
    ['onVideo', 'video'],
    ['onDocument', 'document'],
    ['onSticker', 'sticker'],
    ['onLocation', 'location'],
    ['onContact', 'contact'],
    ['onPoll', 'poll'],
  ] as const)('bot.%s(handler) is onType(%s) and returns an unsubscriber', async (alias, type) => {
    const { bot, provider } = await createTestBot()
    const seen: MessageType[] = []
    const off = bot[alias]((ctx) => { seen.push(ctx.type) })
    provider.incoming('', { from: 'u1', type, id: 'a' })
    await vi.waitFor(() => expect(seen).toEqual([type]))
    off()
    provider.incoming('', { from: 'u1', type, id: 'b' })
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).toEqual([type])
    await bot.stop()
  })

  it('bot.useFlow(flow) registers the flow like bot.use(flow)', async () => {
    const { bot, chat } = await createTestBot()
    expect(bot.useFlow(flow('menu').say('menu!'))).toBe(bot)
    await chat.send('menu')
    await chat.expectReply('menu!')
    await bot.stop()
  })

  it('bot.use(plugin) still plugs a plugin (like bot.plug)', async () => {
    const { bot, chat } = await createTestBot()
    bot.use({ name: 'legacy-plugin', version: '1.0.0', install: ({ bot: b }) => { b.when('ping', (ctx) => ctx.reply('pong')) } })
    await chat.send('ping')
    await chat.expectReply('pong')
    await bot.stop()
  })
})
