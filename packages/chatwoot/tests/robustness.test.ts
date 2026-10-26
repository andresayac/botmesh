/** Bursts, seeded webhook fuzzing and resource hygiene through the public API. */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { chatwootPlugin } from '../src/index.js'
import { FakeChatwoot, publicResolver } from './fakeChatwoot.js'

function make(fake = new FakeChatwoot(), over: Record<string, unknown> = {}) {
  return chatwootPlugin({
    baseUrl: 'https://chatwoot.example.com', apiKey: 'secret-key', accountId: 1, inboxId: 2,
    webhookToken: 'hook-token', webhookSecret: 'shh', now: () => 1_800_000_000_000,
    http: { fetch: fake.fetch as typeof globalThis.fetch, resolver: publicResolver },
    ...over,
  })
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('chatwoot — bursts across many chats', () => {
  it('one contact and conversation per chat, messages in order, unicode intact', async () => {
    const fake = new FakeChatwoot()
    const plugin = make(fake)
    const t = await createTestBot()
    t.bot.plug(plugin)
    const chats = Array.from({ length: 40 }, (_, i) => `chat-${i}-ñ🎉@c.us`)
    await Promise.all(chats.map(async (id) => {
      const c = t.dm(id)
      for (let j = 0; j < 6; j++) await c.send(`m${j} — ¿qué tal? 👋🏽 ${id}`)
    }))
    await plugin.flush()
    expect(fake.contacts).toHaveLength(40)
    expect(fake.conversations.size).toBe(40)
    for (const id of chats) {
      const conv = await plugin.conversationOf(id)
      expect(fake.messagesOf(conv!).map((m) => m.content)).toEqual(Array.from({ length: 6 }, (_, j) => `m${j} — ¿qué tal? 👋🏽 ${id}`))
      expect(await plugin.chatOf(conv!)).toBe(id)
    }
    await t.bot.stop()
  })
})

describe('chatwoot — seeded webhook fuzzing', () => {
  const shapes: Array<(r: () => number) => unknown> = [
    () => null, () => 42, () => 'str', () => [], () => ({}),
    (r) => ({ event: 'message_created', id: Math.floor(r() * 1e6), message_type: r() < 0.5 ? 'outgoing' : 1, content: r() < 0.5 ? 'x'.repeat(Math.floor(r() * 50)) : { nested: true }, conversation: r() < 0.5 ? { id: '1e400' } : { id: -1 }, attachments: r() < 0.5 ? 'nope' : [{ data_url: 'file:///etc/passwd' }, null, 7] }),
    (r) => ({ event: 'conversation_status_changed', id: r() < 0.5 ? '__proto__' : Math.floor(r() * 1e3), status: 'resolved', changed_attributes: r() < 0.5 ? null : [{ status: null }] }),
    (r) => ({ event: 'conversation_updated', id: 1, status: 'resolved', changed_attributes: r() < 0.5 ? 'x' : { status: { current_value: 'resolved' } } }),
    () => ({ __proto__: { event: 'message_created' }, constructor: { prototype: { polluted: true } } }),
  ]

  it('never throws, never sends for unknown conversations and authenticates first', async () => {
    const r = rng(20261026)
    const plugin = make()
    const t = await createTestBot()
    t.bot.plug(plugin)
    for (let i = 0; i < 400; i++) {
      const shape = shapes[Math.floor(r() * shapes.length)]!(r)
      let raw: string | Buffer = JSON.stringify(shape) ?? 'undefined'
      if (r() < 0.2) raw = Buffer.from(Array.from({ length: Math.floor(r() * 64) }, () => Math.floor(r() * 256)))
      if (r() < 0.1) raw = String(raw).slice(0, Math.floor(r() * String(raw).length))
      const mode = r()
      const headers: Record<string, string> = {}
      let query: Record<string, unknown> | undefined
      if (mode < 0.3) query = { token: 'hook-token' }
      else if (mode < 0.5) query = { token: ['hook-token'] }
      else if (mode < 0.7) {
        const ts = String(1_800_000_000 + Math.floor((r() - 0.5) * 1000))
        headers['x-chatwoot-timestamp'] = ts
        headers['x-chatwoot-signature'] = createHmac('sha256', 'shh').update(`${ts}.`).update(raw).digest('hex')
      } else headers['x-chatwoot-signature'] = 'zz'.repeat(Math.floor(r() * 40))
      const res = await plugin.handleWebhook({ rawBody: raw, headers, query })
      expect([200, 400, 401]).toContain(res.status)
      if (mode >= 0.7 || (mode >= 0.3 && mode < 0.5)) expect(res.status).toBe(401)
    }
    await plugin.flush()
    expect(t.provider.outbox).toHaveLength(0)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    await t.bot.stop()
  })
})

describe('chatwoot — resource hygiene', () => {
  it('leaves no timers or handles behind after flush() and bot.stop(), across stop/start cycles', async () => {
    const before = process.getActiveResourcesInfo().filter((x) => x !== 'TTYWrap')
    for (let cycle = 0; cycle < 3; cycle++) {
      const fake = new FakeChatwoot()
      const plugin = make(fake)
      const t = await createTestBot()
      const unplug = t.bot.plug(plugin)
      t.bot.when('hola', (ctx) => ctx.reply('hey'))
      await t.chat.send('hola')
      await t.chat.expectReply('hey')
      await plugin.flush()
      unplug()
      await t.bot.stop()
      expect(fake.onlyConversation().messages).toHaveLength(2)
    }
    await new Promise((r) => setImmediate(r))
    const after = process.getActiveResourcesInfo().filter((x) => x !== 'TTYWrap')
    expect(after.filter((x) => x === 'Timeout').length).toBeLessThanOrEqual(before.filter((x) => x === 'Timeout').length)
  })
})
