/**
 * End to end through the public API: many chats bursting at once, stop/start cycles,
 * handoff, unicode bodies and seeded fuzzing of the message text.
 */
import { describe, expect, it } from 'vitest'
import { Bot } from '@botmesh/core'
import { moderationPlugin, type ModerationReport } from '../src/index.js'
import { AdminMockProvider, flush, groupMsg, startBot } from './helpers.js'

function collect(bot: Bot): ModerationReport[] {
  const reports: ModerationReport[] = []
  bot.on('moderation', (r: ModerationReport) => reports.push(r))
  return reports
}

describe('moderation — end to end', () => {
  it('handles a burst in 100 chats at once: one warning per offender, nothing else lost', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    bot.plug(moderationPlugin({ provider, antiSpam: { maxMessages: 5, windowMs: 60_000 } }))
    const reports = collect(bot)
    let routed = 0
    bot.onMessage(() => { routed++ })
    for (let i = 0; i < 8; i++) for (let c = 0; c < 100; c++) groupMsg(provider, `m${i} 🚀`, `u${c}`, `g${c}`)
    await new Promise((r) => setTimeout(r, 300))
    expect(reports).toHaveLength(100)
    expect(new Set(reports.map((r) => r.chatId)).size).toBe(100)
    expect(routed).toBe(700)
    await bot.stop()
  })

  it('keeps moderating (and keeps its state) across stop/start cycles', async () => {
    const provider = new AdminMockProvider()
    const bot = new Bot({ provider })
    bot.plug(moderationPlugin({ provider, wordFilter: { banned: ['scam'], action: 'warn' } }))
    const reports = collect(bot)
    for (let cycle = 0; cycle < 3; cycle++) {
      await bot.start()
      groupMsg(provider, `scam ${cycle}`)
      await flush()
      await bot.stop()
    }
    expect(reports.map((r) => r.warnings)).toEqual([1, 2, 0])
    expect(provider.kicked).toEqual([{ chatId: 'g1', userIds: ['u1'] }])
  })

  it('still moderates a chat in handoff', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    bot.plug(moderationPlugin({ provider, wordFilter: { banned: ['scam'] } }))
    const reports = collect(bot)
    await bot.handoff('g1')
    groupMsg(provider, 'scam')
    await flush()
    expect(reports).toHaveLength(1)
    expect(provider.deleted).toHaveLength(1)
    await bot.stop()
  })

  it('survives seeded random bodies (unicode, lone surrogates, huge text) without dispatch errors', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    const errors: unknown[] = []
    bot.on('error', (e) => errors.push(e))
    bot.plug(moderationPlugin({
      provider,
      antiSpam: { maxMessages: 1000, windowMs: 1000 },
      wordFilter: { banned: ['spam', 'ñandú', /x{3}/] },
      linkFilter: { allLinks: true, allowDomains: ['example.com'], allowInvites: ['OURCODE1'] },
    }))
    const parts = ['https://', 'www.', 't.me/+', 'chat.whatsapp.com/', 'discord.gg/', 'example.com', '​', '\uD800', '😀', 'ñ',
      'é', ' ', '\n', '/', '.', '?', '#', 'spam', 'OURCODE1', 'ｈｔｔｐｓ：／／', '‮', '%00']
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    let routed = 0
    bot.onMessage(() => { routed++ })
    for (let i = 0; i < 400; i++) {
      let body = ''
      const n = Math.floor(rnd() * 40)
      for (let j = 0; j < n; j++) body += parts[Math.floor(rnd() * parts.length)]
      groupMsg(provider, body, `u${i % 7}`, `g${i % 5}`)
    }
    groupMsg(provider, 'a'.repeat(500_000) + ' https://chat.whatsapp.com/ABCDEFGHI')
    await new Promise((r) => setTimeout(r, 500))
    expect(errors).toEqual([])
    expect(routed).toBeGreaterThan(0)
    await bot.stop()
  })
})
