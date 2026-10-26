import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Bot, OutsideSessionWindowError, PayloadTooLargeError, RateLimitedError, RecipientUnreachableError, ProviderError, loadMediaOf } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'
import pino from 'pino'
import { WhatsAppSimulator, serveWebhooks, type BotIngress } from '../src/index.js'

const silent = pino({ level: 'silent' })

describe('WhatsApp Cloud API simulator + CloudAPIProvider over real HTTP', () => {
  const sim = new WhatsAppSimulator()
  let bot: Bot
  let provider: CloudAPIProvider
  let ingress: BotIngress
  const sendErrors: unknown[] = []

  beforeAll(async () => {
    await sim.start()
    provider = new CloudAPIProvider({ ...sim.providerConfig(), logger: silent })
    bot = new Bot({ provider, logger: silent })
    bot.when('hola', (ctx) => ctx.reply('¡Hola!'))
    bot.when('menu', (ctx) => ctx.buttons('¿Qué quieres?', [{ id: 'cafe', title: 'Café' }, { id: 'pan', title: 'Pan' }]))
    bot.when('lista', (ctx) => bot.send(ctx.from, {
      kind: 'list', text: 'Elige', buttonText: 'Ver',
      sections: [{ title: 'Panes', rows: [{ id: 'baguette', title: 'Baguette' }, { id: 'croissant', title: 'Croissant', description: 'De mantequilla' }] }],
    }))
    bot.when('cafe', (ctx) => ctx.reply(`elegiste ${ctx.body}`))
    bot.when('croissant', (ctx) => ctx.reply(`lista: ${ctx.body}`))
    bot.when('donde', (ctx) => ctx.location(4.65, -74.05, 'Tienda'))
    bot.when('foto', (ctx) => ctx.photo({ url: 'https://example.com/a.jpg' }, 'una foto'))
    bot.when('subir', (ctx) => ctx.photo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'subida'))
    bot.when('plantilla', (ctx) => bot.send(ctx.from, { kind: 'template', name: 'hello_world', language: 'en_US' }))
    bot.when('enviar', async (ctx) => {
      try { await ctx.reply('intento') } catch (err) { sendErrors.push(err) }
    })
    bot.onType('image', async (ctx) => {
      const media = await loadMediaOf(ctx, { throwOnError: true })
      await ctx.reply(`imagen ${media?.buffer.length} bytes ${media?.mimetype}`)
    })
    bot.onType('location', (ctx) => ctx.reply(`ubicación ${ctx.sharedLocation?.latitude},${ctx.sharedLocation?.longitude}`))
    ingress = await serveWebhooks([{ path: '/webhook/whatsapp', provider }])
    sim.setWebhook(ingress.webhook('/webhook/whatsapp'))
    await bot.start()
  })

  afterAll(async () => {
    await bot.stop()
    await ingress.close()
    await sim.stop()
  })

  beforeEach(() => { sim.reset(); sendErrors.length = 0 })

  it('passes the GET subscription handshake', async () => {
    expect(await sim.verifySubscription()).toEqual({ status: 200, ok: true })
    expect((await sim.verifySubscription('wrong')).ok).toBe(false)
  })

  it('delivers a signed text and receives the reply through the Graph API', async () => {
    const out = await sim.sendText('hola')
    expect(out.deliveries[0]).toMatchObject({ status: 200, ok: true })
    const reply = await sim.waitForOutbound((r) => r.kind === 'text')
    expect(reply).toMatchObject({ chatId: sim.describe().user.id, text: '¡Hola!' })
    expect(sim.issues()).toEqual([])
  })

  it('sends reply buttons and routes the button reply', async () => {
    await sim.sendText('menu')
    const menu = await sim.waitForOutbound((r) => r.kind === 'buttons')
    expect(menu.buttons).toEqual([{ id: 'cafe', title: 'Café' }, { id: 'pan', title: 'Pan' }])
    await sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café', messageId: menu.id } })
    const answer = await sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)
    expect(answer.text).toBe('elegiste cafe')
    expect(sim.issues()).toEqual([])
  })

  it('sends a list and routes the list reply', async () => {
    await sim.sendText('lista')
    const list = await sim.waitForOutbound((r) => r.kind === 'list')
    expect(list.sections?.[0]?.rows.map((r) => r.id)).toEqual(['baguette', 'croissant'])
    await sim.send({ reply: { kind: 'list', id: 'croissant', title: 'Croissant' } })
    expect((await sim.waitForOutbound((r) => r.text?.startsWith('lista:') === true)).text).toBe('lista: croissant')
  })

  it('downloads inbound media through the two-step media API', async () => {
    await sim.send({ media: { kind: 'image', data: Buffer.alloc(1234, 7), mimetype: 'image/png', caption: 'mira' } })
    expect((await sim.waitForOutbound((r) => r.text?.startsWith('imagen') === true)).text).toBe('imagen 1234 bytes image/png')
  })

  it('normalizes an inbound location', async () => {
    await sim.send({ location: { latitude: 4.6, longitude: -74.08, name: 'Bogotá' } })
    expect((await sim.waitForOutbound((r) => r.text?.startsWith('ubicación') === true)).text).toBe('ubicación 4.6,-74.08')
  })

  it('sends location, link media, uploaded media and templates', async () => {
    await sim.sendText('donde')
    expect((await sim.waitForOutbound((r) => r.kind === 'location')).location).toMatchObject({ latitude: 4.65, longitude: -74.05 })
    await sim.sendText('foto')
    expect((await sim.waitForOutbound((r) => r.kind === 'image' && !!r.media?.url)).media?.url).toBe('https://example.com/a.jpg')
    await sim.sendText('subir')
    const uploaded = await sim.waitForOutbound((r) => r.kind === 'image' && !!r.media?.mediaId)
    expect(sim.media.peek(uploaded.media!.mediaId!)?.origin).toBe('bot')
    await sim.sendText('plantilla')
    expect((await sim.waitForOutbound((r) => r.kind === 'template')).template).toMatchObject({ name: 'hello_world', language: 'en_US' })
    expect(sim.issues()).toEqual([])
  })

  it.each([
    ['rateLimit', RateLimitedError],
    ['invalidRecipient', RecipientUnreachableError],
    ['outsideWindow', OutsideSessionWindowError],
    ['mediaTooLarge', PayloadTooLargeError],
    ['auth', ProviderError],
  ] as const)('maps a %s answer to a typed error', async (kind, type) => {
    // A long Retry-After: ctx replies only retry short waits in place.
    sim.fail(kind, { match: (req) => req.path.endsWith('/messages'), retryAfterSec: 30 })
    await sim.sendText('enviar')
    await expect.poll(() => sendErrors.length, { timeout: 5000 }).toBe(1)
    expect(sendErrors[0]).toBeInstanceOf(type)
    if (kind === 'rateLimit') expect((sendErrors[0] as RateLimitedError).retryAfterMs).toBe(30_000)
  })

  it('a short 429 is retried in place by ctx.reply and the reply goes through', async () => {
    sim.fail('rateLimit', { match: (req) => req.path.endsWith('/messages'), retryAfterSec: 0.05 })
    await sim.sendText('enviar')
    expect((await sim.waitForOutbound((r) => r.text === 'intento')).text).toBe('intento')
    expect(sendErrors).toEqual([])
    await expect.poll(() => sim.requests.filter((r) => r.path.endsWith('/messages')).map((r) => r.status)).toEqual([429, 200])
  })

  it('rejects a webhook with a bad or missing signature', async () => {
    const out = await sim.post({ object: 'whatsapp_business_account', entry: [] }, { signature: 'sha256=' + '0'.repeat(64) })
    expect(out[0]!.status).toBe(403)
    const unsigned = await sim.post({ object: 'whatsapp_business_account', entry: [] }, { signature: false })
    expect(unsigned[0]!.status).toBe(403)
  })
})
