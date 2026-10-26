import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OutsideSessionWindowError, PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { TwilioProvider } from '@botmesh/twilio'
import { TwilioSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

describe('Twilio simulator + TwilioProvider over real HTTP', () => {
  let h: Harness<TwilioSimulator, TwilioProvider>
  let rec: Recorded
  const statuses: string[] = []
  beforeAll(async () => {
    h = await startHarness(new TwilioSimulator(), (sim, ctx) => new TwilioProvider({ ...sim.providerConfig(ctx.webhookUrl), statusCallback: ctx.webhookUrl, logger: silent }), (bot) => {
      rec = standardHandlers(bot)
      bot.on('status', (s) => { statuses.push(String(s.status)) })
      bot.when('escribe', async (ctx) => { await ctx.typing(); await ctx.reply('listo') })
    }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0; statuses.length = 0 })

  it('delivers a signed form webhook and answers through the Messages API', async () => {
    const out = await h.sim.sendText('hola')
    expect(out.deliveries[0]!.status).toBe(200)
    const reply = await h.sim.waitForOutbound((r) => r.kind === 'text')
    expect(reply).toMatchObject({ chatId: 'whatsapp:+573001112233', text: '¡Hola!' })
    expect(reply.id).toMatch(/^SM[0-9a-f]{32}$/)
    expect(h.sim.issues()).toEqual([])
  })

  it('degrades buttons to a numbered menu and routes a quick-reply payload', async () => {
    await h.sim.sendText('menu')
    const menu = await h.sim.waitForOutbound((r) => r.text?.includes('1. Café') === true)
    expect(menu.text).toContain('2. Pan')
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
  })

  it('downloads inbound media through the authenticated media URL and its CDN redirect', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toBe(`media image ${JPEG.length} bytes image/jpeg`)
    const mediaReq = h.sim.requests.find((r) => r.path.includes('/Media/'))
    expect(mediaReq?.status).toBe(307)
  })

  it('reads an inbound location and sends one as a persistent geo action', async () => {
    await h.sim.send({ location: { latitude: 4.6, longitude: -74.08, name: 'Parque' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('ubicación') === true)).text).toBe('ubicación 4.6,-74.08')
    await h.sim.sendText('donde')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'location')).location).toMatchObject({ latitude: 4.65, longitude: -74.05, name: 'Tienda' })
    expect(h.sim.issues()).toEqual([])
  })

  it('sends hosted media and content templates', async () => {
    await h.sim.sendText('foto')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'image')).media?.url).toBe('https://example.com/pan.jpg')
    await h.sim.sendText('plantilla')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'template')).template?.name).toBe('hello_world')
    expect(h.sim.issues()).toEqual([])
  })

  it('sends the WhatsApp typing indicator for the last inbound message', async () => {
    const inbound = await h.sim.sendText('escribe')
    const typing = await h.sim.waitForOutbound((r) => r.action === 'typing')
    expect(typing.targetId).toBe(inbound.id)
    await h.sim.waitForOutbound((r) => r.text === 'listo')
    expect(h.sim.issues()).toEqual([])
  })

  it('delivers signed status callbacks to the bot', async () => {
    await h.sim.sendText('hola')
    const reply = await h.sim.waitForOutbound((r) => r.kind === 'text')
    await h.sim.status(reply.id, 'delivered')
    await h.sim.status(reply.id, 'read')
    await expect.poll(() => statuses).toEqual(['delivered', 'read'])
  })

  it.each([
    ['rateLimit', RateLimitedError],
    ['invalidRecipient', RecipientUnreachableError],
    ['outsideWindow', OutsideSessionWindowError],
    ['mediaTooLarge', PayloadTooLargeError],
    ['auth', ProviderError],
  ] as const)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => req.path.endsWith('/Messages.json'), retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })

  it('rejects a webhook with a forged or missing X-Twilio-Signature', async () => {
    const params = { MessageSid: 'SM' + '1'.repeat(32), From: 'whatsapp:+1', To: 'whatsapp:+2', Body: 'x', AccountSid: h.sim.accountSid }
    expect((await h.sim.post(params, { signature: 'AAAA' }))[0]!.status).toBe(403)
    expect((await h.sim.post(params, { signature: false }))[0]!.status).toBe(403)
  })
})
