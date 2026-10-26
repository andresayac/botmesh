import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OutsideSessionWindowError, PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { GoHighLevelProvider } from '@botmesh/gohighlevel'
import { GoHighLevelSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

describe('HighLevel simulator + GoHighLevelProvider over real HTTP', () => {
  let h: Harness<GoHighLevelSimulator, GoHighLevelProvider>
  let rec: Recorded
  beforeAll(async () => {
    h = await startHarness(new GoHighLevelSimulator({ messageType: 'WhatsApp' }), (sim) => new GoHighLevelProvider({ ...sim.providerConfig(), logger: silent }), (bot) => {
      rec = standardHandlers(bot)
      bot.when('leido', (ctx) => ctx.markRead())
    }, { bot: { logger: silent } })
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0 })

  it('verifies the Ed25519 signature and answers on the contact channel', async () => {
    await h.sim.sendText('hola')
    const reply = await h.sim.waitForOutbound()
    expect(reply).toMatchObject({ kind: 'text', text: '¡Hola!', chatId: 'cnt_SandboxContact01' })
    expect((reply.raw as { type?: string }).type).toBe('WhatsApp')
    expect(h.sim.issues()).toEqual([])
  })

  it('numbered menus round-trip as text', async () => {
    await h.sim.sendText('menu')
    expect((await h.sim.waitForOutbound()).text).toContain('1. Café')
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'cafe' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
  })

  it('downloads an inbound attachment and sends hosted media and templates', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toMatch(new RegExp(`^media image ${JPEG.length} bytes`))
    await h.sim.sendText('foto')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'image')).media?.url).toBe('https://example.com/pan.jpg')
    await h.sim.sendText('plantilla')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'template')).template?.name).toBe('hello_world')
    expect(h.sim.issues()).toEqual([])
  })

  it('marks the conversation read', async () => {
    await h.sim.sendText('leido')
    expect((await h.sim.waitForOutbound((r) => r.action === 'mark_read')).targetId).toBeTruthy()
    expect(h.sim.issues()).toEqual([])
  })

  it.each([
    ['rateLimit', RateLimitedError],
    ['invalidRecipient', RecipientUnreachableError],
    ['outsideWindow', OutsideSessionWindowError],
    ['mediaTooLarge', PayloadTooLargeError],
    ['auth', ProviderError],
  ] as const)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => req.path === '/conversations/messages', retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })

  it('rejects unsigned and forged webhooks', async () => {
    const body = { type: 'InboundMessage', locationId: h.sim.locationId, contactId: 'x', body: 'hola' }
    expect((await h.sim.post(body, { signature: false }))[0]!.status).toBe(401)
    expect((await h.sim.post(body, { signature: Buffer.alloc(64).toString('base64') }))[0]!.status).toBe(401)
  })
})
