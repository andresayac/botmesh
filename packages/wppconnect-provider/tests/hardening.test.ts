/**
 * Findings from running the provider against a real wppconnect-server
 * (`wppconnect/server-cli:1.3.50`, WPPConnect-Server 2.10.42, @wppconnect-team/wppconnect 2.3.4).
 */
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { ProviderError, UnsupportedContentError, type InboundEvent } from '@botmesh/core'
import { WaIdentityStore } from '@botmesh/wa-gateway-kit'
import { WPPConnectProvider, toWppError } from '../src/index.js'
import { parseWebhook } from '../src/parseInbound.js'
import { fakeFetch, fixture, resolver, type Responder } from './support/fake.js'

const H = { 'x-webhook-token': 'w' }
const LID = '184523390222111@lid'
const PN = '573001112233@c.us'

function make(responder: Responder, extra: Record<string, unknown> = {}) {
  const { fetch, calls } = fakeFetch(responder)
  const provider = new WPPConnectProvider({
    session: 's', token: 't', webhookToken: 'w', http: { fetch, resolver }, logger: pino({ level: 'silent' }), ...extra,
  })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e) })
  return { provider, calls, events }
}

describe('status-find as the real server sends it', () => {
  const ctx = () => ({ identity: new WaIdentityStore() })

  it('an unpaired session sends "inChat" before "notLogged": "inChat" is not a ready signal', () => {
    // Recorded order on a fresh session: status-find inChat, status-find notLogged, qrcode.
    expect(parseWebhook({ event: 'status-find', session: 's', status: 'inChat' }, ctx())).toEqual([])
    expect(parseWebhook({ event: 'status-find', session: 's', status: 'isLogged' }, ctx())).toEqual([{ kind: 'connection', update: { state: 'ready' } }])
    expect(parseWebhook({ event: 'status-find', session: 's', status: 'qrReadSuccess' }, ctx())).toEqual([{ kind: 'connection', update: { state: 'ready' } }])
  })

  it('a device unlinked from the phone ("disconnectedMobile") closes the session as invalid', () => {
    expect(parseWebhook({ event: 'status-find', session: 's', status: 'disconnectedMobile' }, ctx())[0])
      .toMatchObject({ kind: 'connection', update: { state: 'closed', reason: 'sessionInvalid', detail: { code: 'disconnectedMobile' } } })
  })

  it('"phoneNotConnected" closes the session (transient)', () => {
    expect(parseWebhook({ event: 'status-find', session: 's', status: 'phoneNotConnected' }, ctx())[0])
      .toMatchObject({ kind: 'connection', update: { state: 'closed', reason: 'transient', detail: { code: 'phoneNotConnected' } } })
  })

  it('the provider never reports ready for an unpaired session', async () => {
    const { provider, events } = make(() => ({ body: {} }))
    for (const status of ['inChat', 'notLogged']) await provider.ingest({ event: 'status-find', session: 's', status }, H)
    await provider.ingest({ event: 'qrcode', session: 's', qrcode: 'iVBOR', urlcode: 'https://wa.me/settings/linked_devices#2@x' }, H)
    expect(events.map((e) => e.kind === 'connection' && e.update.state)).toEqual(['authenticating', 'authenticating'])
  })
})

describe('LID lookups', () => {
  it('a LID linked to its PN by a lookup is not looked up again on every message', async () => {
    let fail = true
    const { provider, calls, events } = make((c) => c.url.includes('pn-lid')
      ? (fail ? { status: 500, body: {} } : { body: fixture('pn-lid-response') })
      : { body: {} }, { lidRetryMs: 0 })
    let n = 0
    const dm = () => ({ event: 'onmessage', session: 's', id: `false_${LID}_X${++n}`, body: 'hi', type: 'chat', from: LID, to: '573009998877@c.us', chatId: LID, isGroupMsg: false, sender: { id: LID } })
    await provider.ingest(dm(), H) // lookup fails: the contact is first seen LID-only
    fail = false
    for (let i = 0; i < 5; i++) await provider.ingest(dm(), H)
    expect(calls.filter((c) => c.url.includes('pn-lid'))).toHaveLength(2)
    const senders = events.flatMap((e) => (e.kind === 'message' ? [e.message.senderId] : []))
    expect(new Set(senders)).toEqual(new Set([LID])) // first-seen id stays stable
  })
})

describe('error quality', () => {
  it('an unpaired or stopped session says so in English, with the next step', async () => {
    const { provider } = make(() => ({ status: 404, body: { response: null, status: 'Disconnected', message: 'A sessão do WhatsApp não está ativa.', session: '' } }))
    const err = await provider.send(PN, { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/session is not connected/i)
    expect((err as Error).message).toMatch(/pair|QR/i)
  })

  it('an HTML error page (unknown endpoint) is reduced to its text', () => {
    const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot POST /api/s/nope</pre>\n</body>\n</html>\n'
    expect(toWppError(404, html, PN).message).toBe('WPPConnect HTTP 404: Cannot POST /api/s/nope')
  })

  it('a contact without digits or a location with invalid coordinates rejects before any request', async () => {
    const { provider, calls } = make(() => ({ body: {} }))
    await expect(provider.send(PN, { kind: 'contact', phone: 'abc' })).rejects.toBeInstanceOf(UnsupportedContentError)
    await expect(provider.send(PN, { kind: 'location', lat: Number.NaN, lng: 1 })).rejects.toBeInstanceOf(UnsupportedContentError)
    await expect(provider.send(PN, { kind: 'location', lat: 91, lng: 1 })).rejects.toThrow(/latitude/)
    expect(calls).toHaveLength(0)
  })
})
