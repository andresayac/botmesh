import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OutsideSessionWindowError, PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { GupshupProvider } from '@botmesh/gupshup'
import { GupshupSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

describe('Gupshup simulator + GupshupProvider over real HTTP', () => {
  let h: Harness<GupshupSimulator, GupshupProvider>
  let rec: Recorded
  const statuses: string[] = []
  beforeAll(async () => {
    h = await startHarness(new GupshupSimulator(), (sim) => new GupshupProvider({ ...sim.providerConfig(), logger: silent }), (bot) => {
      rec = standardHandlers(bot)
      bot.on('status', (s) => { statuses.push(String(s.status)) })
    }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0; statuses.length = 0 })

  it('answers a v2 text callback through /wa/api/v1/msg', async () => {
    await h.sim.sendText('hola')
    expect(await h.sim.waitForOutbound()).toMatchObject({ kind: 'text', text: '¡Hola!', chatId: '573001112233' })
    expect(h.sim.issues()).toEqual([])
  })

  it('sends quick replies and lists, and routes their replies', async () => {
    await h.sim.sendText('menu')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'buttons')).buttons?.map((b) => b.id)).toEqual(['cafe', 'pan'])
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
    await h.sim.sendText('lista')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'list')).sections?.[0]?.rows.map((r) => r.id)).toEqual(['baguette', 'croissant'])
    await h.sim.send({ reply: { kind: 'list', id: 'croissant', title: 'Croissant' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('lista:') === true)).text).toBe('lista: croissant')
    expect(h.sim.issues()).toEqual([])
  })

  it('downloads inbound media, reads a location, sends location and templates', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg', caption: 'pan' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toBe(`media image ${JPEG.length} bytes image/jpeg`)
    await h.sim.send({ location: { latitude: 4.6, longitude: -74.08 } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('ubicación') === true)).text).toBe('ubicación 4.6,-74.08')
    await h.sim.sendText('donde')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'location')).location).toMatchObject({ latitude: 4.65, longitude: -74.05 })
    await h.sim.sendText('plantilla')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'template')).template?.name).toBe('hello_world')
    expect(h.sim.issues()).toEqual([])
  })

  it('delivers message-event statuses', async () => {
    await h.sim.sendText('hola')
    const reply = await h.sim.waitForOutbound()
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
    h.sim.fail(kind, { retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })

  it('rejects a callback without (or with the wrong) token', async () => {
    const body = { app: 'SandboxApp', type: 'message', payload: {} }
    expect((await h.sim.post(body, { token: false }))[0]!.status).toBe(401)
    expect((await h.sim.post(body, { token: 'nope' }))[0]!.status).toBe(401)
  })
})

describe('Gupshup callbacks with the token in the query string (the documented callback URL)', () => {
  it('are accepted through the @botmesh/server ingress, which passes the request URL to ingest()', async () => {
    const h = await startHarness(new GupshupSimulator({ tokenIn: 'query' }), (sim) => new GupshupProvider({ ...sim.providerConfig(), logger: silent }), (bot) => {
      standardHandlers(bot)
      bot.when('largo', (ctx) => ctx.buttons('Elige 👇', [{ id: 'a', title: 'Confirmar la reservación ahora' }, { id: 'b', title: 'Cancelar 🙅‍♀️🙅‍♀️🙅‍♀️🙅‍♀️🙅‍♀️' }]))
    }, { bot: { logger: silent } })
    try {
      const sent = await h.sim.sendText('hola')
      expect(sent.deliveries[0]!.status).toBe(200)
      expect(await h.sim.waitForOutbound()).toMatchObject({ kind: 'text', text: '¡Hola!' })
      expect((await h.sim.post({ app: 'SandboxApp', type: 'message', payload: {} }, { token: 'nope' }))[0]!.status).toBe(401)
      // Titles over WhatsApp's 20 characters are cut instead of rejected by the API.
      await h.sim.sendText('largo')
      expect((await h.sim.waitForOutbound((r) => r.kind === 'buttons')).buttons?.map((b) => b.id)).toEqual(['a', 'b'])
      expect(h.sim.issues()).toEqual([])
    } finally {
      await h.stop()
    }
  })
})
