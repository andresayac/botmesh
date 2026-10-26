import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OutsideSessionWindowError, PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { MessengerProvider } from '@botmesh/messenger'
import { InstagramProvider } from '@botmesh/instagram'
import { InstagramSimulator, MessengerSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

const typed = [
  ['rateLimit', RateLimitedError],
  ['invalidRecipient', RecipientUnreachableError],
  ['outsideWindow', OutsideSessionWindowError],
  ['mediaTooLarge', PayloadTooLargeError],
  ['auth', ProviderError],
] as const

describe('Messenger simulator + MessengerProvider over real HTTP', () => {
  let h: Harness<MessengerSimulator, MessengerProvider>
  let rec: Recorded
  beforeAll(async () => {
    h = await startHarness(new MessengerSimulator(), (sim) => new MessengerProvider({ ...sim.providerConfig(), logger: silent }), (bot) => { rec = standardHandlers(bot) }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0 })

  it('verifies the subscription and answers a signed text', async () => {
    expect((await h.sim.verifySubscription()).ok).toBe(true)
    await h.sim.sendText('hola')
    expect(await h.sim.waitForOutbound((r) => r.kind === 'text')).toMatchObject({ text: '¡Hola!', chatId: h.sim.describe().user.id })
    expect(h.sim.issues()).toEqual([])
  })

  it('sends a button template and routes the postback', async () => {
    await h.sim.sendText('menu')
    const menu = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
    expect(menu.buttons?.map((b) => b.id)).toEqual(['cafe', 'pan'])
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
    expect(h.sim.issues()).toEqual([])
  })

  it('sends a list as a generic template and routes the row postback', async () => {
    await h.sim.sendText('lista')
    const list = await h.sim.waitForOutbound((r) => r.kind === 'list')
    expect(list.sections?.[0]?.rows.map((r) => r.id)).toEqual(['baguette', 'croissant'])
    await h.sim.send({ reply: { kind: 'list', id: 'croissant', title: 'Croissant' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('lista:') === true)).text).toBe('lista: croissant')
  })

  it('downloads an inbound attachment from the CDN URL and reads a location', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toBe(`media image ${JPEG.length} bytes image/jpeg`)
    await h.sim.send({ location: { latitude: 4.6, longitude: -74.08 } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('ubicación') === true)).text).toBe('ubicación 4.6,-74.08')
  })

  it('an expired attachment URL surfaces as an unavailable download', async () => {
    const out = await h.sim.prepare({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    for (const m of h.sim.media.list('user')) h.sim.media.expire(m.id)
    await h.sim.deliver(out)
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toBe('media image unavailable')
    expect(rec.sendErrors[0]).toBeInstanceOf(ProviderError)
  })

  it('sends hosted media by URL', async () => {
    await h.sim.sendText('foto')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'image')).media?.url).toBe('https://example.com/pan.jpg')
    expect(h.sim.issues()).toEqual([])
  })

  it.each(typed)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => (req.json() as { message?: unknown })?.message !== undefined, retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })

  it('rejects forged webhooks', async () => {
    expect((await h.sim.post({ object: 'page', entry: [] }, { signature: 'sha256=' + 'a'.repeat(64) }))[0]!.status).toBe(403)
  })
})

describe('Instagram simulator + InstagramProvider over real HTTP', () => {
  let h: Harness<InstagramSimulator, InstagramProvider>
  let rec: Recorded
  beforeAll(async () => {
    h = await startHarness(new InstagramSimulator(), (sim) => new InstagramProvider({ ...sim.providerConfig(), logger: silent }), (bot) => { rec = standardHandlers(bot) }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0 })

  it('answers a signed text and quick replies round-trip', async () => {
    await h.sim.sendText('hola')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'text')).text).toBe('¡Hola!')
    await h.sim.sendText('menu')
    const menu = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
    expect(menu.buttons?.map((b) => b.id)).toEqual(['cafe', 'pan'])
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
    expect(h.sim.issues()).toEqual([])
  })

  it('downloads an inbound image', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toBe(`media image ${JPEG.length} bytes image/jpeg`)
  })

  it.each(typed)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => (req.json() as { message?: unknown })?.message !== undefined, retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })

  it('rejects unsigned webhooks', async () => {
    expect((await h.sim.post({ object: 'instagram', entry: [] }, { signature: false }))[0]!.status).toBe(403)
  })
})
