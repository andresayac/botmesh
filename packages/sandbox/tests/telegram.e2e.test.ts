import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { TelegramProvider } from '@botmesh/telegram'
import { TelegramSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

describe('Telegram simulator + TelegramProvider (long polling)', () => {
  let h: Harness<TelegramSimulator, TelegramProvider>
  let rec: Recorded
  beforeAll(async () => {
    h = await startHarness(new TelegramSimulator(), (sim) => new TelegramProvider({ ...sim.providerConfig('polling'), logger: silent }), (bot) => {
      rec = standardHandlers(bot)
      bot.when('confirmar', async (ctx) => { await ctx.acknowledge?.('ok') ; await ctx.reply('confirmado') })
    }, { webhook: false, bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0 })

  it('delivers updates through getUpdates and answers with sendMessage', async () => {
    await h.sim.sendText('hola')
    expect(await h.sim.waitForOutbound()).toMatchObject({ kind: 'text', text: '¡Hola!', chatId: '123456789' })
    expect(h.sim.issues()).toEqual([])
  })

  it('inline keyboards round-trip through callback_query', async () => {
    await h.sim.sendText('menu')
    const menu = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
    expect(menu.buttons?.map((b) => b.id)).toEqual(['cafe', 'pan'])
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', messageId: menu.id } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
    await h.sim.send({ reply: { kind: 'button', id: 'confirmar' } })
    expect((await h.sim.waitForOutbound((r) => r.action === 'answer_callback_query')).text).toBe('ok')
    expect(h.sim.issues()).toEqual([])
  })

  it('downloads media with getFile + /file/bot<token>/, uploads buffers as multipart', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toMatch(new RegExp(`^media image ${JPEG.length} bytes`))
    await h.sim.send({ media: { kind: 'voice', data: Buffer.from('OggS-voice'), mimetype: 'audio/ogg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media voice') === true)).text).toBe('media voice 10 bytes audio/ogg')
    await h.sim.sendText('subir')
    const up = await h.sim.waitForOutbound((r) => r.kind === 'image')
    expect(up.media?.mediaId).toMatch(/^AgAC/)
    expect(h.sim.issues()).toEqual([])
  })

  it('reads locations and sends locations, polls and lists', async () => {
    await h.sim.send({ location: { latitude: 4.6, longitude: -74.08 } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('ubicación') === true)).text).toBe('ubicación 4.6,-74.08')
    await h.sim.sendText('donde')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'location')).location).toMatchObject({ latitude: 4.65, longitude: -74.05 })
    await h.sim.sendText('encuesta')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'poll')).poll?.options).toEqual(['Pan', 'Café'])
    await h.sim.sendText('lista')
    expect((await h.sim.waitForOutbound((r) => r.text?.includes('Elige un pan') === true)).buttons?.map((b) => b.id)).toEqual(['baguette', 'croissant'])
    expect(h.sim.issues()).toEqual([])
  })

  it('delivers an edited message as a new input with the original id', async () => {
    const first = await h.sim.sendText('nada')
    await h.sim.send({ edit: { messageId: first.id, text: 'hola' } })
    expect((await h.sim.waitForOutbound((r) => r.text === '¡Hola!')).text).toBe('¡Hola!')
  })

  it.each([
    ['rateLimit', RateLimitedError],
    ['invalidRecipient', RecipientUnreachableError],
    ['outsideWindow', RecipientUnreachableError],
    ['mediaTooLarge', PayloadTooLargeError],
    ['serverError', ProviderError],
  ] as const)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => req.params['method'] === 'sendMessage', retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })
})

describe('Telegram simulator + TelegramProvider (webhook with secret token)', () => {
  let h: Harness<TelegramSimulator, TelegramProvider>
  beforeAll(async () => {
    h = await startHarness(new TelegramSimulator(), (sim) => new TelegramProvider({ ...sim.providerConfig('webhook'), logger: silent }), (bot) => { standardHandlers(bot) }, { body: 'text', bot: { logger: silent } })
  })
  afterAll(() => h.stop())

  it('answers a webhook update and rejects a wrong or missing secret', async () => {
    const out = await h.sim.sendText('hola')
    expect(out.deliveries[0]!.status).toBe(200)
    expect((await h.sim.waitForOutbound()).text).toBe('¡Hola!')
    expect((await h.sim.post({ update_id: 1 }, { secret: 'wrong' }))[0]!.status).toBe(401)
    expect((await h.sim.post({ update_id: 2 }, { secret: false }))[0]!.status).toBe(401)
  })
})
