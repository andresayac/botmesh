/**
 * Behaviours found against a real Evolution API v2.3.4 container: payload
 * shapes and error bodies captured from the server, replayed against the
 * provider with a fake fetch.
 */
import { describe, it, expect } from 'vitest'
import { ProviderError, UnsupportedContentError, type ConnectionUpdate, type InboundEvent } from '@botmesh/core'
import { WaIdentityStore } from '@botmesh/wa-gateway-kit'
import pino from 'pino'
import { EvolutionProvider, toEvolutionError } from '../src/index.js'
import { parseWebhook } from '../src/parseInbound.js'
import { fakeFetch, fixture, resolver, type Responder } from './support/fake.js'

const PN = '573001112233@s.whatsapp.net'
const LID = '184523390222111@lid'
const BASE = 'http://localhost:8080'
const H = { 'x-webhook-secret': 'hook-secret' }

function make(responder: Responder = () => ({ body: fixture('send-text-response') }), logs: string[] = []) {
  const { fetch, calls } = fakeFetch(responder)
  const provider = new EvolutionProvider({
    baseUrl: BASE,
    apiKey: 'API-KEY',
    instance: 'my-instance',
    webhookSecret: 'hook-secret',
    http: { fetch, resolver },
    logger: pino({ level: 'debug' }, { write: (s: string) => { logs.push(s) } }),
  })
  return { provider, calls, logs }
}

const connections = (events: InboundEvent[]): ConnectionUpdate[] =>
  events.flatMap((e) => (e.kind === 'connection' ? [e.update] : []))

describe('connection.update states seen on a real server', () => {
  it("reports 'refused' (QR code limit reached) as closed/sessionInvalid instead of dropping it", () => {
    // Evolution v2.3.4 sends this pair when QRCODE_LIMIT is reached on an unpaired instance.
    const qr = parseWebhook({ event: 'qrcode.updated', instance: 'i', data: { message: 'QR code limit reached, please login again', statusCode: 500 } }, { identity: new WaIdentityStore() })
    expect(qr).toEqual([])
    const [update] = connections(parseWebhook({ event: 'connection.update', instance: 'i', data: { instance: 'i', state: 'refused', statusReason: 428 } }, { identity: new WaIdentityStore() }))
    expect(update).toMatchObject({ state: 'closed', reason: 'sessionInvalid', detail: { code: 428 } })
    expect(update.detail?.message).toMatch(/QR code limit/i)
  })

  it('maps close codes like the Baileys provider (badSession/multidevice → sessionInvalid, forbidden → sessionTakenOver)', () => {
    const reasonOf = (statusReason: number) =>
      connections(parseWebhook({ event: 'connection.update', data: { state: 'close', statusReason } }, { identity: new WaIdentityStore() }))[0]?.reason
    expect(reasonOf(401)).toBe('sessionInvalid')
    expect(reasonOf(500)).toBe('sessionInvalid')
    expect(reasonOf(411)).toBe('sessionInvalid')
    expect(reasonOf(440)).toBe('sessionTakenOver')
    expect(reasonOf(403)).toBe('sessionTakenOver')
    expect(reasonOf(428)).toBe('transient')
    expect(reasonOf(515)).toBe('transient')
  })

  it('links previousRemoteJid (the LID Evolution swaps for senderPn) to the PN', () => {
    const identity = new WaIdentityStore()
    parseWebhook({ event: 'messages.upsert', data: { key: { remoteJid: PN, previousRemoteJid: LID, senderPn: PN, fromMe: false, id: 'A1' }, message: { conversation: 'hola' } } }, { identity })
    const [later] = parseWebhook({ event: 'messages.upsert', data: { key: { remoteJid: LID, fromMe: false, id: 'A2' }, message: { conversation: 'otra' } } }, { identity })
    expect(later.kind === 'message' && later.message.senderId).toBe(PN)
  })
})

describe('deleteMessage without the native key', () => {
  it('defaults to fromMe: true (deleting the bot\'s own message), like the Baileys provider', async () => {
    const { provider, calls } = make(() => ({ body: {} }))
    await provider.deleteMessage({ id: 'M9', chatId: PN })
    expect(calls[0].body).toEqual({ id: 'M9', remoteJid: PN, fromMe: true })
  })

  it('keeps fromMe: false from a native inbound key (an admin deleting someone else\'s message)', async () => {
    const { provider, calls } = make(() => ({ body: {} }))
    await provider.deleteMessage({ id: 'M9', chatId: PN, native: { remoteJid: PN, fromMe: false, id: 'M9' } })
    expect(calls[0].body).toEqual({ id: 'M9', remoteJid: PN, fromMe: false })
  })
})

describe('markRead without native keys', () => {
  it('marks every ref as a message from the peer (fromMe: false), whatever its position', async () => {
    const { provider, calls } = make(() => ({ body: {} }))
    ;(provider as unknown as { presenceReady: boolean }).presenceReady = true
    await provider.markRead([{ id: 'R1', chatId: PN }, { id: 'R2', chatId: PN }, { id: 'R3', chatId: PN }])
    expect(calls[0].body.readMessages.map((k: { fromMe: boolean }) => k.fromMe)).toEqual([false, false, false])
  })
})

describe('poll validation (Evolution answers a schema 400 or forwards invalid polls unchecked)', () => {
  const cases: Array<[string, { question: string; options: string[] }]> = [
    ['one option', { question: 'q', options: ['a'] }],
    ['13 options', { question: 'q', options: Array.from({ length: 13 }, (_, i) => `o${i}`) }],
    ['an empty question', { question: ' ', options: ['a', 'b'] }],
    ['an empty option', { question: 'q', options: ['a', ''] }],
    ['duplicate options', { question: 'q', options: ['a', 'a'] }],
  ]
  for (const [name, poll] of cases) {
    it(`rejects ${name} with UnsupportedContentError before calling Evolution`, async () => {
      const { provider, calls } = make()
      const err = await provider.send(PN, { kind: 'poll', ...poll }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toMatch(/poll/i)
      expect(calls).toHaveLength(0)
    })
  }

  it('still sends a valid 12-option poll', async () => {
    const { provider, calls } = make()
    await provider.send(PN, { kind: 'poll', question: 'q', options: Array.from({ length: 12 }, (_, i) => `o${i}`) })
    expect(calls[0].url).toBe(`${BASE}/message/sendPoll/my-instance`)
  })
})

describe('error quality', () => {
  it('explains the TypeError Evolution returns when the instance has no WhatsApp session', () => {
    // Real v2.3.4 bodies for an instance that was never connected (or logged out).
    const bodies = [
      { status: 500, error: 'Internal Server Error', response: { message: "Cannot read properties of undefined (reading 'onWhatsApp')" } },
      { status: 400, error: 'Bad Request', response: { message: ["TypeError: Cannot read properties of undefined (reading 'onWhatsApp')"] } },
      { status: 500, error: 'Internal Server Error', response: { message: ['Read messages fail', "TypeError: Cannot read properties of undefined (reading 'readMessages')"] } },
    ]
    for (const body of bodies) {
      const err = toEvolutionError(body.status, body, PN)
      expect(err).toBeInstanceOf(ProviderError)
      expect(err.message).toMatch(/not connected to WhatsApp/)
      expect(err.message).toMatch(/start\(\)/)
    }
  })

  it('does not misread "Message not found" (getBase64FromMediaMessage) as an unreachable recipient', () => {
    const err = toEvolutionError(400, { status: 400, error: 'Bad Request', response: { message: ['Message not found'] } }, PN)
    expect(err.constructor).toBe(ProviderError)
  })

  it('logs an actionable warning when an authenticated webhook body is not an Evolution webhook', () => {
    const { provider, logs } = make()
    expect(provider.ingest(undefined, H)).toBe(400)
    expect(provider.ingest('{oops', H)).toBe(400)
    const warnings = logs.filter((l) => l.includes('"level":40'))
    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).toMatch(/body parser|raw body/i)
  })

  it('names the expected header when a webhook is rejected, never the secret', () => {
    const { provider, logs } = make()
    expect(provider.ingest(fixture('messages-upsert-text-dm'), { 'x-webhook-secret': 'wrong' })).toBe(401)
    const all = logs.join('\n')
    expect(all).toMatch(/x-webhook-secret/)
    expect(all).not.toContain('hook-secret"')
    expect(all).not.toContain('wrong')
  })
})
