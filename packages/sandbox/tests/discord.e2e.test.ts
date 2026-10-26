import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PayloadTooLargeError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { DiscordProvider } from '@botmesh/discord'
import { DiscordSimulator, startHarness, type Harness } from '../src/index.js'
import { JPEG, silent, standardHandlers, type Recorded } from './_bot.js'

describe('Discord simulator (REST + Gateway) + DiscordProvider over real sockets', () => {
  let h: Harness<DiscordSimulator, DiscordProvider>
  let rec: Recorded
  beforeAll(async () => {
    h = await startHarness(new DiscordSimulator(), (sim) => new DiscordProvider({ ...sim.providerConfig(), reconnectDelayMs: 20, logger: silent }), (bot) => {
      rec = standardHandlers(bot)
      bot.when('reacciona', (ctx) => ctx.react('👍'))
      bot.when('confirmar', async (ctx) => { await ctx.acknowledge?.('¡Listo!') })
    }, { webhook: false, bot: { logger: silent } })
    await h.sim.waitForGateway()
  })
  afterAll(() => h.stop())
  beforeEach(() => { h.sim.reset(); rec.sendErrors.length = 0 })

  it('identifies over the gateway and answers a DM through REST', async () => {
    expect(h.sim.identifies.at(-1)?.['intents']).toEqual(expect.any(Number))
    const sent = await h.sim.sendText('hola')
    expect(await h.sim.waitForOutbound()).toMatchObject({ kind: 'text', text: '¡Hola!', chatId: sent.chatId })
    expect(h.sim.issues()).toEqual([])
  })

  it('sends buttons and select menus and routes the component interactions', async () => {
    await h.sim.sendText('menu')
    const menu = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
    expect(menu.buttons?.map((b) => b.id)).toEqual(['cafe', 'pan'])
    await h.sim.send({ reply: { kind: 'button', id: 'cafe', title: 'Café', messageId: menu.id } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('elegiste') === true)).text).toBe('elegiste cafe')
    await h.sim.sendText('lista')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'list')).sections?.[0]?.rows.map((r) => r.id)).toEqual(['baguette', 'croissant'])
    await h.sim.send({ reply: { kind: 'list', id: 'croissant', title: 'Croissant' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('lista:') === true)).text).toBe('lista: croissant')
    expect(h.sim.issues()).toEqual([])
  })

  it('ctx.acknowledge() answers the interaction callback (the core does not auto-ack)', async () => {
    await h.sim.send({ reply: { kind: 'button', id: 'confirmar', title: 'Confirmar' } })
    const ack = await h.sim.waitForOutbound((r) => r.action?.startsWith('interaction_callback') === true)
    expect(ack).toMatchObject({ action: 'interaction_callback:4', text: '¡Listo!' })
    expect(h.sim.issues()).toEqual([])
  })

  it('downloads an inbound attachment, uploads an outbound file and sends a native poll', async () => {
    await h.sim.send({ media: { kind: 'image', data: JPEG, mimetype: 'image/jpeg', filename: 'pan.jpg' } })
    expect((await h.sim.waitForOutbound((r) => r.text?.startsWith('media') === true)).text).toBe(`media image ${JPEG.length} bytes image/jpeg`)
    await h.sim.sendText('subir')
    const up = await h.sim.waitForOutbound((r) => r.kind === 'image')
    expect(up.media?.url).toContain('/discord/cdn/attachments/')
    await h.sim.sendText('encuesta')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'poll')).poll).toEqual({ question: '¿Pan o café?', options: ['Pan', 'Café'] })
    await h.sim.sendText('reacciona')
    expect((await h.sim.waitForOutbound((r) => r.kind === 'reaction')).text).toBe('👍')
    expect(h.sim.issues()).toEqual([])
  })

  it('resumes the gateway session after a drop and keeps receiving', async () => {
    h.sim.dropGateway(4000)
    await new Promise((r) => setTimeout(r, 50))
    await h.sim.waitForGateway()
    await h.sim.sendText('hola')
    expect((await h.sim.waitForOutbound()).text).toBe('¡Hola!')
  })

  it.each([
    ['rateLimit', RateLimitedError],
    ['invalidRecipient', RecipientUnreachableError],
    ['mediaTooLarge', PayloadTooLargeError],
    ['auth', ProviderError],
  ] as const)('maps a %s answer to a typed error', async (kind, type) => {
    h.sim.fail(kind, { match: (req) => req.method === 'POST' && req.path.endsWith('/messages'), retryAfterSec: 30 })
    await h.sim.sendText('enviar')
    await expect.poll(() => rec.sendErrors.length).toBe(1)
    expect(rec.sendErrors[0]).toBeInstanceOf(type)
  })
})
