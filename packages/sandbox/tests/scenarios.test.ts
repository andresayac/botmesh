import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMediaOf } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'
import { TelegramProvider } from '@botmesh/telegram'
import { TelegramSimulator, WhatsAppSimulator, burst, duplicate, expiredMedia, outOfOrder, startHarness, statusSequence, type Harness } from '../src/index.js'
import { JPEG, silent } from './_bot.js'

const stops: Array<() => Promise<void>> = []
afterEach(async () => { while (stops.length) await stops.pop()!() })

async function whatsapp(simOpts: ConstructorParameters<typeof WhatsAppSimulator>[0] = {}): Promise<{ h: Harness<WhatsAppSimulator, CloudAPIProvider>; seen: string[]; statuses: string[] }> {
  const seen: string[] = []
  const statuses: string[] = []
  const h = await startHarness(new WhatsAppSimulator(simOpts), (sim) => new CloudAPIProvider({ ...sim.providerConfig(), logger: silent }), (bot) => {
    bot.onType('text', async (ctx) => { seen.push(ctx.body); await ctx.reply(`eco: ${ctx.body}`) })
    bot.onType('image', async (ctx) => {
      const m = await loadMediaOf(ctx)
      await ctx.reply(m ? 'imagen ok' : 'imagen no disponible')
    })
    bot.on('status', (s) => { statuses.push(String(s.status)) })
  }, { bot: { logger: silent } })
  stops.push(() => h.stop())
  return { h, seen, statuses }
}

describe('scenario helpers', () => {
  it('a duplicated webhook (same message id) is handled once', async () => {
    const { h, seen } = await whatsapp()
    const out = await duplicate(h.sim, { text: 'hola' }, 3)
    expect(out.every((o) => o.deliveries[0]!.status === 200)).toBe(true)
    await h.sim.waitForOutbound()
    await new Promise((r) => setTimeout(r, 100))
    expect(seen).toEqual(['hola'])
    expect(h.sim.outbox).toHaveLength(1)
  })

  it('out-of-order webhooks are each handled, in arrival order', async () => {
    const { h, seen } = await whatsapp()
    await outOfOrder(h.sim, [{ text: 'uno' }, { text: 'dos' }, { text: 'tres' }])
    await h.sim.waitForOutboundCount(3)
    expect(seen).toEqual(['tres', 'dos', 'uno'])
  })

  it('a burst from several users gets one answer each', async () => {
    const { h } = await whatsapp()
    await burst(h.sim, Array.from({ length: 10 }, (_, i) => ({ text: `m${i}`, user: { id: `1555000${String(i).padStart(4, '0')}` } })))
    const replies = await h.sim.waitForOutboundCount(10)
    expect(new Set(replies.map((r) => r.chatId)).size).toBe(10)
  })

  it('an expired media URL reaches the handler as an unavailable download', async () => {
    const { h } = await whatsapp()
    await expiredMedia(h.sim, { media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound()).text).toBe('imagen no disponible')
  })

  it('media URLs expire after mediaTtlMs', async () => {
    const { h } = await whatsapp({ mediaTtlMs: 1 })
    const prepared = await h.sim.prepare({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    await new Promise((r) => setTimeout(r, 10))
    await h.sim.deliver(prepared)
    expect((await h.sim.waitForOutbound()).text).toBe('imagen no disponible')
  })

  it('status sequences and autoStatus reach the bot as status events', async () => {
    const { h, statuses } = await whatsapp()
    await h.sim.sendText('hola')
    const reply = await h.sim.waitForOutbound()
    await statusSequence(h.sim, reply.id)
    await expect.poll(() => statuses).toEqual(['sent', 'delivered', 'read'])
    statuses.length = 0
    h.sim.setAutoStatus('read')
    await h.sim.sendText('otra')
    await expect.poll(() => statuses, { timeout: 3000 }).toEqual(['delivered', 'read'])
  })

  it('the platform retries a webhook the bot answered with 5xx', async () => {
    const { h, seen } = await whatsapp({ webhookRetries: 2, webhookRetryDelayMs: 10 })
    // A front proxy that fails the first request, then forwards to the bot.
    let calls = 0
    const target = h.sim.webhook!
    const proxy = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', async () => {
        calls += 1
        if (calls === 1) { res.writeHead(503).end(); return }
        try {
          const headers = { 'content-type': String(req.headers['content-type']), 'x-hub-signature-256': String(req.headers['x-hub-signature-256']) }
          const r = await fetch(target, { method: 'POST', headers, body: Buffer.concat(chunks) })
          res.writeHead(r.status).end(await r.text())
        } catch {
          res.writeHead(502).end()
        }
      })
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    stops.push(() => new Promise<void>((resolve) => proxy.close(() => resolve())))
    h.sim.setWebhook(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}/webhook/whatsapp`)
    const out = await h.sim.sendText('reintento')
    expect(out.deliveries.map((d) => d.status)).toEqual([503, 200])
    await h.sim.waitForOutbound()
    expect(seen).toEqual(['reintento'])
  })

  it('Telegram: a redelivered update with a new update_id but the same message is deduplicated', async () => {
    const seen: string[] = []
    const h = await startHarness(new TelegramSimulator(), (sim) => new TelegramProvider({ ...sim.providerConfig('polling'), logger: silent }), (bot) => {
      bot.onType('text', async (ctx) => { seen.push(ctx.body); await ctx.reply('ok') })
    }, { webhook: false, bot: { logger: silent } })
    stops.push(() => h.stop())
    await duplicate(h.sim, { text: 'hola' }, 2)
    await h.sim.waitForOutbound()
    await new Promise((r) => setTimeout(r, 300))
    expect(seen).toEqual(['hola'])
  })
})
