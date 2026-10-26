/**
 * Review findings on the real-server hardening: identity under cache pressure,
 * bounded work on hostile HTML error pages, and no secretKey in error messages.
 */
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { WPPConnectProvider, toWppError } from '../src/index.js'
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

let n = 0
const dm = (from: string) => ({ event: 'onmessage', session: 's', id: `false_${from}_R${++n}`, body: 'hi', type: 'chat', from, to: '573009998877@c.us', chatId: from, isGroupMsg: false, sender: { id: from } })

describe('LID link evicted from the identity cache', () => {
  it('is looked up again, so the senderId stays the PN', async () => {
    const { provider, events } = make((c) => c.url.includes('pn-lid') ? { body: fixture('pn-lid-response') } : { body: {} }, { identityCacheSize: 4 })
    await provider.ingest(dm(LID), H)
    for (let i = 0; i < 6; i++) await provider.ingest(dm(`57300000000${i}@c.us`), H)
    await provider.ingest(dm(LID), H)
    const senders = events.flatMap((e) => (e.kind === 'message' && e.message.chatId !== undefined ? [e.message.senderId] : []))
    expect(senders[0]).toBe(PN)
    expect(senders.at(-1)).toBe(PN)
  })
})

describe('HTML error bodies', () => {
  it('a huge page of unclosed tags is reduced quickly', () => {
    const body = '<html>' + '<script>'.repeat(80_000) + '<pre>'.repeat(40_000)
    const t0 = performance.now()
    const err = toWppError(500, body, '')
    expect(performance.now() - t0).toBeLessThan(250)
    expect(err.message.length).toBeLessThan(400)
  })
})

describe('secretKey redaction', () => {
  const SECRET = 'rv-secret/XYZ'
  const ENC = encodeURIComponent(SECRET)

  it('an HTML 404 from generate-token does not echo the secretKey', async () => {
    const page = (path: string) => `<!DOCTYPE html><html><head><title>Error</title></head><body><pre>Cannot POST ${path}</pre></body></html>`
    const { provider, events } = make((c) => c.url.includes('generate-token')
      ? { status: 404, body: page(new URL(c.url).pathname) }
      : { body: {} }, { token: undefined, secretKey: SECRET })
    const err = await provider.start().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain('{secretKey}')
    expect(msg).not.toContain(ENC)
    expect(msg).not.toContain('rv-secret')
    const closed = events.find((e) => e.kind === 'connection' && e.update.state === 'closed')
    expect(closed).toBeDefined()
    expect(JSON.stringify(closed)).toContain('{secretKey}')
    expect(JSON.stringify(closed)).not.toContain('rv-secret')
  })

  it('a JSON error body echoing the raw secretKey is redacted too', async () => {
    const { provider } = make((c) => c.url.includes('generate-token')
      ? { status: 500, body: { message: `bad key ${SECRET}` } }
      : { body: {} }, { token: undefined, secretKey: SECRET })
    const err = await provider.start().catch((e: unknown) => e)
    expect((err as Error).message).not.toContain('rv-secret')
  })
})
