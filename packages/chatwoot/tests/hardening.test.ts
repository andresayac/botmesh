import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { chatwootPlugin } from '../src/index.js'
import { ChatwootMapping, memoryKeyValue } from '../src/mapping.js'
import { FakeChatwoot, publicResolver } from './fakeChatwoot.js'

function plugin(over: Record<string, unknown> = {}) {
  const fake = new FakeChatwoot()
  return chatwootPlugin({
    baseUrl: 'https://chatwoot.test', apiKey: 'k', accountId: 1, inboxId: 1,
    webhookSecret: 'shh', now: () => 1_800_000_000_000,
    http: { fetch: fake.fetch as typeof globalThis.fetch, resolver: publicResolver },
    ...over,
  } as Parameters<typeof chatwootPlugin>[0])
}

describe('chatwoot — webhook signatures are bound to a timestamp', () => {
  const raw = Buffer.from(JSON.stringify({ event: 'conversation_created', id: 1 }))
  const sig = (msg: string | Buffer) => createHmac('sha256', 'shh').update(msg).digest('hex')

  it('rejects a signature without x-chatwoot-timestamp by default (it could be replayed forever)', async () => {
    const { bot } = await createTestBot()
    const p = plugin()
    bot.plug(p)
    expect((await p.handleWebhook({ rawBody: raw, headers: { 'x-chatwoot-signature': sig(raw) } })).status).toBe(401)
    // A timestamp header does not unlock the untimed form either.
    const ts = String(1_800_000_000)
    expect((await p.handleWebhook({ rawBody: raw, headers: { 'x-chatwoot-signature': sig(raw), 'x-chatwoot-timestamp': ts } })).status).toBe(401)
    expect((await p.handleWebhook({ rawBody: raw, headers: { 'x-chatwoot-signature': sig(`${ts}.${raw.toString()}`), 'x-chatwoot-timestamp': ts } })).status).toBe(200)
    await bot.stop()
  })

  it('accepts the untimed form only with webhookAllowUntimedSignature: true', async () => {
    const { bot } = await createTestBot()
    const p = plugin({ webhookAllowUntimedSignature: true })
    bot.plug(p)
    expect((await p.handleWebhook({ rawBody: raw, headers: { 'x-chatwoot-signature': sig(raw) } })).status).toBe(200)
    await bot.stop()
  })
})

describe('chatwoot — mapping cache is bounded', () => {
  it('keeps at most maxCached links in memory and still answers from storage', async () => {
    const kv = memoryKeyValue()
    const m = new ChatwootMapping(kv, 'chatwoot:', 100)
    for (let i = 0; i < 1_000; i++) await m.set(`c${i}`, { contactId: i, conversationId: 10_000 + i })
    const internals = m as unknown as { links: Map<string, unknown>; reverse: Map<number, string> }
    expect(internals.links.size).toBeLessThanOrEqual(100)
    expect(internals.reverse.size).toBeLessThanOrEqual(100)
    expect(await m.get('c1')).toEqual({ contactId: 1, conversationId: 10_001 })
    expect(await m.chatOf(10_002)).toBe('c2')
    expect(internals.links.size).toBeLessThanOrEqual(100)
  })
})
