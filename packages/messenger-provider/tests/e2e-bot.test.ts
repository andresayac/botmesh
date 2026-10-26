/**
 * End-to-end through the public API: Bot + MessengerProvider with a signed
 * webhook (X-Hub-Signature-256 over the raw bytes) and a stubbed Graph `fetch`.
 */
import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Bot, type InboundReaction } from '@botmesh/core'
import { MessengerProvider } from '../src/MessengerProvider.js'

const SECRET = 'app-secret'
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await tick(5)
  }
}
const sign = (raw: string) => ({ 'X-Hub-Signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` })
const body = (...messaging: unknown[]) => JSON.stringify({ object: 'page', entry: [{ id: 'PG', time: 1, messaging }] })

interface Call { url: string; body: any }
function stubGraph(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ recipient_id: 'PSID', message_id: `mid.${calls.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
afterEach(() => { vi.unstubAllGlobals() })

describe('Messenger + Bot end to end', () => {
  it('answers a signed text webhook; a forged one is 403 and never reaches the bot', async () => {
    const calls = stubGraph()
    const provider = new MessengerProvider({ accessToken: 'PAGE-TOKEN', verifyToken: 'v', appSecret: SECRET })
    const bot = new Bot({ provider })
    bot.when('hola', (ctx) => ctx.reply('¡Hola! ¿En qué te ayudo? 😊'))
    await bot.start()
    try {
      const raw = body({ sender: { id: 'PSID-1' }, recipient: { id: 'PG' }, timestamp: 1_760_000_000_000, message: { mid: 'm.1', text: 'hola' } })
      expect(provider.ingest(raw.replace('hola', 'HOLA'), sign(raw))).toBe(403)
      expect(provider.ingest(raw, sign(raw))).toBe(200)
      await until(() => calls.length === 1)
      await tick(30)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/me/messages')
      expect(calls[0]!.body).toEqual({ recipient: { id: 'PSID-1' }, messaging_type: 'RESPONSE', message: { text: '¡Hola! ¿En qué te ayudo? 😊' } })
    } finally {
      await bot.stop()
    }
  })

  it('a message_reactions webhook surfaces as the bot "reaction" event', async () => {
    stubGraph()
    const provider = new MessengerProvider({ accessToken: 'PAGE-TOKEN', verifyToken: 'v', appSecret: SECRET })
    const bot = new Bot({ provider })
    const reactions: InboundReaction[] = []
    bot.on('reaction', (r) => { reactions.push(r) })
    await bot.start()
    try {
      const raw = body({ sender: { id: 'PSID-1' }, recipient: { id: 'PG' }, timestamp: 2, reaction: { reaction: 'love', emoji: '❤️', action: 'react', mid: 'm.out.1' } })
      expect(provider.ingest(raw, sign(raw))).toBe(200)
      await until(() => reactions.length === 1)
      expect(reactions[0]).toMatchObject({ emoji: '❤️', senderId: 'PSID-1', removed: false, ref: { id: 'm.out.1', chatId: 'PSID-1' } })
    } finally {
      await bot.stop()
    }
  })
})
