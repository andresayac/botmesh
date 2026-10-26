/**
 * Stability review: memory stays bounded with many chats, and user-controlled text never
 * feeds the warning template.
 */
import { describe, expect, it } from 'vitest'
import { moderationPlugin } from '../src/index.js'
import { AdminMockProvider, flush, groupMsg, startBot, textsTo } from './helpers.js'

/** A banned-word list that counts how many times it is compiled (iterated). */
function countingList(words: string[]): { list: string[]; compiles: () => number } {
  let n = 0
  const list = [...words]
  const iterate = list[Symbol.iterator].bind(list)
  Object.defineProperty(list, Symbol.iterator, { value: () => { n++; return iterate() } })
  return { list, compiles: () => n }
}

describe('moderation — many chats', () => {
  it('compiles the global word filter once, not once per chat (no per-chat cache growth)', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    const { list, compiles } = countingList(['estafa'])
    bot.plug(moderationPlugin({ provider, wordFilter: { banned: list }, groups: { vip: { wordFilter: { banned: ['otra'] } } } }))
    for (let i = 0; i < 200; i++) groupMsg(provider, `hola ${i}`, `u${i}`, `g${i}`)
    groupMsg(provider, 'una estafa', 'u1', 'g7')
    groupMsg(provider, 'otra cosa', 'u1', 'vip')
    await flush()
    await new Promise((r) => setTimeout(r, 100))
    expect(compiles()).toBe(1)
    expect(provider.outbox.filter((m) => m.chatId === 'vip')).toHaveLength(0)
    await bot.stop()
  })
})

describe('moderation — warning template', () => {
  it('does not expand placeholders that come from the user display name', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    bot.plug(moderationPlugin({
      provider,
      wordFilter: { banned: ['estafa'], action: 'warn' },
      messages: { warn: '{name}: {reason} ({count}/{max})', reasons: { wordFilter: 'no' } },
    }))
    groupMsg(provider, 'estafa', 'u1', 'g1', '{reason}{max}{count}')
    await flush()
    await new Promise((r) => setTimeout(r, 50))
    expect(textsTo(provider, 'g1')).toEqual(['{reason}{max}{count}: no (1/3)'])
    await bot.stop()
  })
})
