// A stopped provider must not acknowledge webhooks with 200: the message would be lost.
import { describe, expect, it, vi } from 'vitest'
import { Bot, type LoggerLike } from '@botmesh/core'
import { CloudAPIProvider } from '../src/CloudAPIProvider.js'

const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } } as unknown as LoggerLike
const cfg = { accessToken: 'TOK', phoneNumberId: 'PNID', verifyToken: 'vt', allowUnsignedWebhooks: true, logger: silent }

const webhook = (text: string, id: string) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550000000', phone_number_id: 'PNID' },
        contacts: [{ profile: { name: 'Ana' }, wa_id: '573001112233' }],
        messages: [{ from: '573001112233', id: id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
      },
    }],
  }],
})

describe('stop', () => {
  it('ingest answers 503 while stopped (Meta redelivers) and 200 again after start', async () => {
    const p = new CloudAPIProvider(cfg)
    const bot = new Bot({ provider: p, logger: silent })
    const seen: string[] = []
    bot.onMessage((ctx) => { seen.push(ctx.body) })
    await bot.start()
    expect(p.ingest(webhook('a', 'wamid.1'))).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['a']))
    await bot.stop()
    expect(p.ingest(webhook('b', 'wamid.2'))).toBe(503)
    await bot.start()
    expect(p.ingest(webhook('c', 'wamid.3'))).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['a', 'c']))
    await bot.stop()
  })
})
