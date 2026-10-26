/**
 * Hardening found by the beta release test: config validation, failing admin callbacks,
 * evasion of the word and invite filters, display-name injection, rate-window sweeps,
 * unplug cleanup and the cost of admin lookups.
 */
import { describe, expect, it } from 'vitest'
import type { MessageContext } from '@botmesh/core'
import { moderationPlugin, Moderator, type ModerationConfig, type ModerationReport } from '../src/index.js'
import { findInviteLinks } from '../src/internal.js'
import { AdminMockProvider, flush, groupMsg, startBot, textsTo } from './helpers.js'

const quiet = { warn: () => undefined }

function fakeCtx(from: string, sender: string, body: string): MessageContext {
  return {
    from, sender, body, isGroup: true, ref: { chatId: from, id: `${sender}-${body}` },
    delete: async () => undefined,
  } as unknown as MessageContext
}

describe('moderation — config validation', () => {
  const bad: Array<[string, ModerationConfig, RegExp]> = [
    ['unknown action', { wordFilter: { banned: ['x'], action: 'ban' as never } }, /wordFilter\.action.*'ban'/],
    ['unknown action in a list', { linkFilter: { action: ['delete', 'ban' as never] } }, /linkFilter\.action.*'ban'/],
    ['antiSpam.maxMessages NaN', { antiSpam: { maxMessages: Number.NaN, windowMs: 1000 } }, /antiSpam\.maxMessages/],
    ['antiSpam.windowMs negative', { antiSpam: { maxMessages: 3, windowMs: -1 } }, /antiSpam\.windowMs/],
    ['warnings.max 0', { warnings: { max: 0, then: 'kick' } }, /warnings\.max/],
    ['warnings.then typo', { warnings: { max: 3, then: 'ban' as never } }, /warnings\.then/],
    ['muteMs negative', { muteMs: -5 }, /muteMs/],
    ['banned not an array', { wordFilter: { banned: 'spam' as never } }, /wordFilter\.banned/],
    ['banned term of the wrong type', { wordFilter: { banned: [42 as never] } }, /wordFilter\.banned\[0\]/],
    ['invitePatterns not RegExps', { linkFilter: { invitePatterns: ['x' as never] } }, /linkFilter\.invitePatterns\[0\]/],
    ['kickFallback typo', { kickFallback: 'ignore' as never }, /kickFallback/],
    ['applyTo typo', { applyTo: 'group' as never }, /applyTo/],
    ['adminCacheMs negative', { adminCacheMs: -1 }, /adminCacheMs/],
    ['priority NaN', { priority: Number.NaN }, /priority/],
    ['admins not an array', { admins: 'u1' as never }, /admins/],
    ['group override of the wrong type', { groups: { g1: 'off' as never } }, /groups\["g1"\]/],
    ['bad rule inside a group override', { groups: { g1: { antiSpam: { maxMessages: 0, windowMs: 10 } } } }, /groups\["g1"\]\.antiSpam\.maxMessages/],
  ]

  for (const [name, config, message] of bad) {
    it(`moderationPlugin() rejects ${name} with a clear message`, () => {
      expect(() => moderationPlugin(config)).toThrow(message)
      expect(() => new Moderator(config, quiet, async () => undefined)).toThrow(message)
    })
  }

  it('accepts the documented configurations', () => {
    expect(() => moderationPlugin({
      antiSpam: { maxMessages: 5, windowMs: 10_000, action: 'warn' },
      wordFilter: { banned: ['spam', /bit\.ly\/\w+/i], action: 'delete', wholeWord: false },
      linkFilter: { action: ['delete', 'kick'], allowInvites: ['CODE'], allowDomains: ['example.com'], invitePatterns: [/x\.y\/(\w+)/] },
      warnings: false,
      muteMs: Infinity,
      groups: { a: false, b: { antiSpam: false, wordFilter: { banned: ['free'] } } },
    })).not.toThrow()
  })

  it('setGroupRules validates the new override before applying it', () => {
    const m = new Moderator({}, quiet, async () => undefined)
    expect(() => m.setGroupRules('g1', { wordFilter: { banned: ['x'], action: 'nuke' as never } })).toThrow(/groups\["g1"\]\.wordFilter\.action/)
  })

  it('mute() rejects a duration that is not a positive number', () => {
    const m = new Moderator({}, quiet, async () => undefined)
    expect(() => m.mute('g', 'u', -1)).toThrow(RangeError)
    expect(() => m.mute('g', 'u', Number.NaN)).toThrow(/mute/)
    m.mute('g', 'u', Infinity)
    expect(m.isMuted('g', 'u')).toBe(true)
  })
})

describe('moderation — a failing isAdmin callback', () => {
  it('is logged and treated as non-admin instead of dropping every group message', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    const errors: unknown[] = []
    bot.on('error', (e) => errors.push(e))
    bot.plug(moderationPlugin({ provider, isAdmin: () => { throw new Error('db down') }, wordFilter: { banned: ['scam'] } }))
    const seen: string[] = []
    bot.onMessage((c) => { seen.push(c.body) })
    groupMsg(provider, 'scam here')
    groupMsg(provider, 'hello')
    await flush()
    expect(seen).toEqual(['hello'])
    expect(provider.deleted).toHaveLength(1)
    await bot.stop()
  })

  it('a rejecting async isAdmin behaves the same', async () => {
    const warnings: string[] = []
    const m = new Moderator(
      { wordFilter: { banned: ['scam'] }, isAdmin: async () => { throw new Error('db down') } },
      { warn: (_o, msg) => { warnings.push(String(msg)) } },
      async () => undefined,
    )
    const v = await m.check(fakeCtx('g', 'u', 'scam'))
    expect(v.kind).toBe('violation')
    expect(warnings.some((w) => w.includes('isAdmin'))).toBe(true)
  })
})

describe('moderation — admin lookups only when needed', () => {
  it('does not ask isAdmin / getAdmins for messages that break no rule', async () => {
    const provider = new AdminMockProvider()
    let calls = 0
    const m = new Moderator(
      { provider, wordFilter: { banned: ['scam'] }, isAdmin: () => { calls++; return false } },
      quiet, async () => undefined,
    )
    for (let i = 0; i < 50; i++) expect((await m.check(fakeCtx('g', `u${i}`, 'hello'))).kind).toBe('allow')
    expect(calls).toBe(0)
    expect(provider.adminLookups).toBe(0)
    expect((await m.check(fakeCtx('g', 'u1', 'scam'))).kind).toBe('violation')
    expect(calls).toBe(1)
  })

  it('an admin still bypasses every rule', async () => {
    const provider = new AdminMockProvider()
    provider.admins.g = ['boss']
    const m = new Moderator({ provider, wordFilter: { banned: ['scam'] }, antiSpam: { maxMessages: 1, windowMs: 1000 } }, quiet, async () => undefined)
    expect((await m.check(fakeCtx('g', 'boss', 'scam'))).kind).toBe('allow')
    expect((await m.check(fakeCtx('g', 'boss', 'a'))).kind).toBe('allow')
    expect((await m.check(fakeCtx('g', 'boss', 'b'))).kind).toBe('allow')
  })

  it('backs off after getAdmins fails instead of calling it for every message', async () => {
    let t = 0
    let calls = 0
    const warnings: string[] = []
    const m = new Moderator(
      {
        now: () => t,
        wordFilter: { banned: ['scam'] },
        provider: { groups: { getAdmins: async () => { calls++; throw new Error('rate limited') } } },
      },
      { warn: (_o, msg) => { warnings.push(String(msg)) } },
      async () => undefined,
    )
    for (let i = 0; i < 20; i++) await m.check(fakeCtx('g', 'u', 'scam'))
    expect(calls).toBe(1)
    expect(warnings.filter((w) => w.includes('admins'))).toHaveLength(1)
    t += 60_000
    await m.check(fakeCtx('g', 'u', 'scam'))
    expect(calls).toBe(2)
  })

  it('keeps the last known admin list while the provider is failing', async () => {
    let t = 0
    let fail = false
    const m = new Moderator(
      {
        now: () => t,
        adminCacheMs: 1000,
        wordFilter: { banned: ['scam'] },
        provider: { groups: { getAdmins: async () => { if (fail) throw new Error('down'); return ['boss'] } } },
      },
      quiet, async () => undefined,
    )
    expect((await m.check(fakeCtx('g', 'boss', 'scam'))).kind).toBe('allow')
    fail = true
    t += 5000
    expect((await m.check(fakeCtx('g', 'boss', 'scam'))).kind).toBe('allow')
  })
})

describe('moderation — filter evasion', () => {
  const words = (body: string) => new Moderator({ wordFilter: { banned: ['spam'] } }, quiet, async () => undefined).check(fakeCtx('g', 'u', body))

  it('catches banned words split with invisible characters', async () => {
    for (const body of ['sp​am', 's­pam', 'sp⁠am', '﻿spam', 'sp‍am']) {
      expect((await words(body)).kind, JSON.stringify(body)).toBe('violation')
    }
  })

  it('catches fullwidth and other compatibility forms', async () => {
    for (const body of ['ｓｐａｍ', 'ＳＰＡＭ', '𝐬𝐩𝐚𝐦']) expect((await words(body)).kind, body).toBe('violation')
  })

  it('keeps ñ distinct and does not create false positives', async () => {
    const m = new Moderator({ wordFilter: { banned: ['ano'] } }, quiet, async () => undefined)
    expect((await m.check(fakeCtx('g', 'u', 'feliz año'))).kind).toBe('allow')
    expect((await words('spammer 👨‍👩‍👧 hola'))).toEqual({ kind: 'allow' })
  })

  it('catches invite links split with invisible characters or written in fullwidth', async () => {
    const m = new Moderator({ linkFilter: { action: 'delete' } }, quiet, async () => undefined)
    for (const body of ['join chat.whats​app.com/ABCDEFGH', 'join ｃｈａｔ.ｗｈａｔｓａｐｐ.ｃｏｍ/ABCDEFGH', 'discord​.gg/abcd']) {
      expect((await m.check(fakeCtx('g', 'u', body))).kind, JSON.stringify(body)).toBe('violation')
    }
  })

  it('does not take hosts that merely end in an invite host for invites', () => {
    expect(findInviteLinks('see chat.me/+abcd and https://wt.me/joinchat/xyz1 or mydiscord.gg/abc')).toEqual([])
    expect(findInviteLinks('www.t.me/+abcd')).toHaveLength(1)
    expect(findInviteLinks('(https://t.me/+abcd)')).toHaveLength(1)
  })

  it('catches invites wrapped in WhatsApp formatting (_italic_, *bold*, ~strike~)', async () => {
    const m = new Moderator({ linkFilter: { action: 'delete' } }, quiet, async () => undefined)
    for (const body of [
      'join _chat.whatsapp.com/ABCDEFGH_', '_t.me/+abcdef_', '_discord.gg/abcd_', '_https://chat.whatsapp.com/ABCDEFGH_',
      '*chat.whatsapp.com/ABCDEFGH*', '~t.me/joinchat/abcdef~', '```discord.gg/abcd```',
    ]) {
      expect((await m.check(fakeCtx('g', 'u', body))).kind, body).toBe('violation')
    }
  })

  it('allLinks catches formatted links and still honours allowDomains for them', async () => {
    const m = new Moderator(
      { linkFilter: { action: 'delete', groupInvites: false, allLinks: true, allowDomains: ['example.com'] } },
      quiet, async () => undefined,
    )
    for (const body of ['_https://evil.test/x_', '*www.evil.test*', '~chat.whatsapp.com/ABCDEFGH~', 'see _discord.gg/abcd_']) {
      expect((await m.check(fakeCtx('g', 'u', body))).kind, body).toBe('violation')
    }
    for (const body of ['_https://example.com_', '*www.example.com*', '~https://docs.example.com/a~']) {
      expect((await m.check(fakeCtx('g', 'u', body))).kind, body).toBe('allow')
    }
  })

  it('treats a letter in any script before the host as part of another host', () => {
    expect(findInviteLinks('ñchat.whatsapp.com/ABCDEFGH xchat.whatsapp.com/ABCDEFGH 1t.me/+abcd déiscord.gg/abc')).toEqual([])
    expect(findInviteLinks('_chat.whatsapp.com/ABCDEFGH_')).toEqual([
      { platform: 'whatsapp', code: 'ABCDEFGH', url: 'chat.whatsapp.com/ABCDEFGH' },
    ])
  })
})

describe('moderation — warning text with a hostile display name', () => {
  it('strips control and bidi characters and caps the name length', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    bot.plug(moderationPlugin({ provider, wordFilter: { banned: ['scam'], action: 'warn' } }))
    groupMsg(provider, 'scam', 'u1', 'g1', 'Eve\n‮admin says\u0007' + 'x'.repeat(5000))
    await flush()
    const text = textsTo(provider, 'g1')[0]!
    expect(text).not.toMatch(/[\n‮\u0007]/)
    expect(text.length).toBeLessThan(200)
    expect(text.startsWith('⚠️ Eve admin says')).toBe(true)
    await bot.stop()
  })

  it('falls back to the anonymous label when the name is only invisible characters', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    bot.plug(moderationPlugin({ provider, wordFilter: { banned: ['scam'], action: 'warn' } }))
    groupMsg(provider, 'scam', 'u1', 'g1', '‮​ ')
    await flush()
    expect(textsTo(provider, 'g1')[0]).toMatch(/^⚠️ user: /)
    await bot.stop()
  })
})

describe('moderation — anti-spam windows of different lengths', () => {
  it('a sweep triggered by a short-window group does not reset a long-window group', async () => {
    let t = 0
    const m = new Moderator(
      {
        now: () => t,
        antiSpam: { maxMessages: 3, windowMs: 60_000 },
        groups: { fast: { antiSpam: { maxMessages: 3, windowMs: 1000 } } },
      },
      quiet, async () => undefined,
    )
    // 9,999 fillers + the victim fill the map to the sweep threshold (10,000 keys), so
    // the sweep fires on the fast group's hit, with the fast group's clock and window.
    for (let i = 0; i < 9_999; i++) await m.check(fakeCtx('slow', `filler${i}`, 'hi'))
    for (let i = 0; i < 3; i++) await m.check(fakeCtx('slow', 'victim', 'hi'))
    t = 2000
    await m.check(fakeCtx('fast', 'other', 'hi'))
    expect((await m.check(fakeCtx('slow', 'victim', 'hi'))).kind).toBe('violation')
  })

  it('RateWindow sweeps each key with its own window, not the caller’s', async () => {
    const { RateWindow } = await import('../src/rateWindow.js')
    const w = new RateWindow(2)
    w.hit('long', 0, 60_000)
    w.hit('expired', 0, 1000)
    w.hit('short', 2000, 1000) // size 3 > 2: this hit sweeps
    expect(w.size).toBe(2) // 'expired' went, 'long' stayed
    expect(w.hit('long', 2500, 60_000)).toBe(2)
  })

  it('stays fast with many active senders (the sweep is amortized)', async () => {
    const m = new Moderator({ now: () => 0, antiSpam: { maxMessages: 3, windowMs: 60_000 } }, quiet, async () => undefined)
    const started = performance.now()
    for (let i = 0; i < 30_000; i++) await m.check(fakeCtx('g', `u${i}`, 'hi'))
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('moderation — unplug', () => {
  it('removes ctx.tools.moderation, so the plugin can be plugged again cleanly', async () => {
    const provider = new AdminMockProvider()
    const bot = await startBot(provider)
    const unplug = bot.plug(moderationPlugin({ provider }))
    const first = bot.injectTools.moderation
    expect(first).toBeDefined()
    unplug()
    expect(bot.injectTools.moderation).toBeUndefined()
    bot.plug(moderationPlugin({ provider }))
    expect(bot.injectTools.moderation).toBeDefined()
    expect(bot.injectTools.moderation).not.toBe(first)
    await bot.stop()
  })
})

describe('moderation — reports', () => {
  it('reports carry no message body and the bot never logs it', async () => {
    const lines: string[] = []
    const logger = {
      debug() {}, error() {},
      info(obj: unknown, msg?: string) { lines.push(JSON.stringify(obj) + String(msg)) },
      warn(obj: unknown, msg?: string) { lines.push(JSON.stringify(obj) + String(msg)) },
      child() { return logger },
    }
    const provider = new AdminMockProvider()
    const { Bot } = await import('@botmesh/core')
    const bot = new Bot({ provider, logger })
    await bot.start()
    const reports: ModerationReport[] = []
    bot.on('moderation', (r: ModerationReport) => reports.push(r))
    bot.plug(moderationPlugin({ provider, wordFilter: { banned: ['scam'] } }))
    groupMsg(provider, 'secret-token-123 scam', 'u-private', 'g1')
    await flush()
    expect(reports).toHaveLength(1)
    expect(JSON.stringify(reports[0])).not.toContain('secret-token-123')
    expect(lines.join('\n')).not.toContain('secret-token-123')
    expect(lines.join('\n')).not.toContain('u-private')
    await bot.stop()
  })
})
