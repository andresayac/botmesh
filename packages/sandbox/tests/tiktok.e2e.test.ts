import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OutsideSessionWindowError, PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { TikTokProvider } from '@botmesh/tiktok'
import { TikTokSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

describe('TikTok simulator + TikTokProvider over real HTTP', () => {
  let h: Harness<TikTokSimulator, TikTokProvider>
  let rec: Recorded
  const statuses: string[] = []
  beforeAll(async () => {
    h = await startHarness(new TikTokSimulator(), (sim) => new TikTokProvider({ ...sim.providerConfig(), logger: silent }), (bot) => {
      rec = standardHandlers(bot)
      bot.on('status', (s) => { statuses.push(String(s.status)) })
      bot.when('gracias', (ctx) => ctx.reply('¡Gracias por comentar!'))
    }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0; statuses.length = 0 })

  it('answers a signed DM through business/message/send', async () => {
    const sent = await h.sim.sendText('hola')
    const reply = await h.sim.waitForOutbound((r) => r.kind === 'text')
    expect(reply).toMatchObject({ text: '¡Hola!', chatId: sent.chatId })
    expect(h.sim.issues()).toEqual([])
  })

  it('sends a Q&A card and routes the button reply', async () => {
    await h.sim.sendText('menu')
    const card = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
    expect(card.buttons?.map((b) => b.id)).toEqual(['cafe', 'pan'])
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café', messageId: card.id } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
    expect(h.sim.issues()).toEqual([])
  })

  it('downloads an inbound image through media/download and uploads an outbound one', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toMatch(new RegExp(`^media image ${JPEG.length} bytes`))
    await h.sim.sendText('subir')
    const img = await h.sim.waitForOutbound((r) => r.kind === 'image')
    expect(h.sim.media.peek(img.media!.mediaId!)?.origin).toBe('bot')
    expect(h.sim.issues()).toEqual([])
  })

  it('replies to a public comment on a video', async () => {
    const c = await h.sim.comment('gracias')
    const reply = await h.sim.waitForOutbound((r) => r.chatId.startsWith('comment:'))
    expect(reply).toMatchObject({ chatId: c.chatId, text: '¡Gracias por comentar!' })
    expect(h.sim.issues()).toEqual([])
  })

  it('reports the im_send_msg echo as a sent status', async () => {
    await h.sim.sendText('hola')
    const reply = await h.sim.waitForOutbound()
    await h.sim.status(reply.id, 'sent')
    await expect.poll(() => statuses).toEqual(['sent'])
  })

  it.each([
    ['rateLimit', RateLimitedError],
    ['invalidRecipient', RecipientUnreachableError],
    ['outsideWindow', OutsideSessionWindowError],
    ['mediaTooLarge', PayloadTooLargeError],
    ['auth', ProviderError],
  ] as const)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => req.path.endsWith('/message/send/'), retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })

  it('rejects unsigned, forged and stale webhooks', async () => {
    const body = { event: 'im_receive_msg', user_openid: h.sim.businessId, content: '{}' }
    expect((await h.sim.post(body, { signature: false }))[0]!.status).toBe(403)
    expect((await h.sim.post(body, { signature: `t=${Math.floor(Date.now() / 1000)},s=${'0'.repeat(64)}` }))[0]!.status).toBe(403)
    expect((await h.sim.post(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 }))[0]!.status).toBe(403)
  })
})
