/** Instagram DM over real HTTP under load and lifecycle edges: bursts, redelivery, captions, multi-photo DMs, stop/start. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Bot } from '@botmesh/core'
import { InstagramProvider } from '@botmesh/instagram'
import { InstagramSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent } from './_bot.js'

describe('Instagram simulator + InstagramProvider: load and lifecycle', () => {
  let h: Harness<InstagramSimulator, InstagramProvider>
  let bot: Bot
  const seen: string[] = []
  beforeAll(async () => {
    h = await startHarness(new InstagramSimulator(), (sim) => new InstagramProvider({ ...sim.providerConfig(), logger: silent }), (b) => {
      bot = b
      b.onType('image', async (ctx) => { seen.push(`img:${ctx.ref.id}`) })
      b.when('foto', (ctx) => ctx.photo('https://example.com/pan.jpg', 'Pan del día 🥖'))
      b.onMessage(async (ctx) => {
        seen.push(ctx.body)
        if (ctx.body.startsWith('n')) await ctx.reply(`eco ${ctx.body}`)
      })
    }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); seen.length = 0 })

  it('answers a burst of 40 chats x 5 messages, in order per chat, without spec issues', async () => {
    const chats = Array.from({ length: 40 }, (_, i) => `17841${String(i).padStart(10, '0')}`)
    await Promise.all(chats.map(async (id) => {
      for (let k = 0; k < 5; k++) await h.sim.send({ user: { id }, text: `n${k} ✨` })
    }))
    await expect.poll(() => h.sim.outbox.filter((r) => r.kind === 'text').length, { timeout: 15_000 }).toBe(200)
    for (const id of chats) {
      expect(h.sim.outbox.filter((r) => r.chatId === id).map((r) => r.text)).toEqual([0, 1, 2, 3, 4].map((k) => `eco n${k} ✨`))
    }
    expect(h.sim.issues()).toEqual([])
  })

  it('a redelivered webhook (same mid) is handled once', async () => {
    const p = await h.sim.prepare({ text: 'n-redeliver' })
    await h.sim.deliver(p)
    await h.sim.deliver(p)
    await h.sim.waitForOutbound((r) => r.text === 'eco n-redeliver')
    await new Promise((r) => setTimeout(r, 100))
    expect(h.sim.outbox.filter((r) => r.text === 'eco n-redeliver')).toHaveLength(1)
  })

  it('a media caption reaches the user as text after the image', async () => {
    await h.sim.sendText('foto')
    await h.sim.waitForOutbound((r) => r.kind === 'text' && r.text === 'Pan del día 🥖')
    expect(h.sim.outbox.map((r) => r.kind)).toEqual(['image', 'text'])
    expect(h.sim.issues()).toEqual([])
  })

  it('every photo of a multi-photo DM reaches the bot', async () => {
    const p = await h.sim.prepare({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    const payload = p.payload as { entry: Array<{ messaging: Array<{ message: { mid: string; attachments: unknown[] } }> }> }
    const message = payload.entry[0]!.messaging[0]!.message
    message.attachments = [message.attachments[0], message.attachments[0], message.attachments[0]]
    await h.sim.post(payload)
    await expect.poll(() => seen.filter((s) => s.startsWith('img:')).length).toBe(3)
    expect(seen.filter((s) => s.startsWith('img:'))).toEqual([`img:${message.mid}`, `img:${message.mid}#2`, `img:${message.mid}#3`])
  })

  it('while stopped, webhooks get 503 so Meta redelivers them after the restart', async () => {
    await bot.stop()
    const p = await h.sim.prepare({ text: 'n-during-stop' })
    const first = await h.sim.post(p.payload)
    expect(first.at(-1)!.status).toBe(503)
    await bot.start()
    await h.sim.post(p.payload)
    await h.sim.waitForOutbound((r) => r.text === 'eco n-during-stop')
  })
})
