import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { GoHighLevelProvider } from '../src/GoHighLevelProvider.js'
import { parseInbound } from '../src/parseInbound.js'
import type { GhlWebhookBody } from '../src/types.js'
import { CALL_INBOUND, LOCATION, OUTBOUND_ECHO, SMS_INBOUND, WHATSAPP_IMAGE, keys } from './fixtures.js'
import { eventProblem, int, mutate, pick, randomBytes, randomString, rng } from './fuzz.js'

const FIXTURES = [SMS_INBOUND, WHATSAPP_IMAGE, CALL_INBOUND, OUTBOUND_ECHO]
const K = keys()

function harness() {
  const provider = new GoHighLevelProvider({ accessToken: 't', locationId: LOCATION, publicKey: K.publicKey, logger: pino({ level: 'silent' }) })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e as InboundEvent) })
  return { provider, events }
}

describe('GoHighLevelProvider — fuzzed webhooks', () => {
  it('never throws and only emits well-formed events (signed bodies)', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const payload = mutate(r, pick(r, FIXTURES))
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && r() < 0.7) (payload as Record<string, unknown>)['locationId'] = LOCATION
      const raw = JSON.stringify(payload) ?? 'null'
      let status = 0
      expect(() => { status = provider.ingest(Buffer.from(raw), { 'x-ghl-signature': K.signEd(raw) }) }, `seed ${seed}`).not.toThrow()
      expect([200, 400], `seed ${seed}`).toContain(status)
      for (const e of events) expect(eventProblem(e), `seed ${seed}`).toBeUndefined()
    }
  })

  it('parseInbound tolerates any value', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed)
      const payload = mutate(r, pick(r, FIXTURES)) as GhlWebhookBody
      let out: ReturnType<typeof parseInbound> | undefined
      expect(() => { out = parseInbound(payload) }, `seed ${seed}`).not.toThrow()
      for (const e of out?.events ?? []) expect(eventProblem(e as never), `seed ${seed}`).toBeUndefined()
    }
  })

  it('rejects random bodies and signatures without throwing', () => {
    for (let seed = 1; seed <= 800; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const body = pick(r, [randomBytes(r), JSON.stringify(mutate(r, pick(r, FIXTURES))), mutate(r, pick(r, FIXTURES)), int(r, 3), null])
      const headers = pick(r, [undefined, { 'x-ghl-signature': randomString(r) }, { 'x-wh-signature': randomString(r) }, { 'x-ghl-signature': ['a', 'b'] }])
      let status = 0
      expect(() => { status = provider.ingest(body, headers) }, `seed ${seed}`).not.toThrow()
      expect([400, 401], `seed ${seed}`).toContain(status)
      expect(events.filter((e) => e.kind !== 'connection'), `seed ${seed}`).toEqual([])
    }
  })
})

describe('GoHighLevelProvider — hostile shapes', () => {
  it('parseInbound returns no events for non-object bodies', () => {
    for (const v of [null, undefined, 1, 'x', []]) expect(parseInbound(v as unknown as GhlWebhookBody).events).toEqual([])
  })

  it('numeric or object ids / fields become strings (or are dropped), never leak raw', () => {
    const { events } = parseInbound({ ...SMS_INBOUND, messageId: 12345, conversationId: { a: 1 }, from: 7, body: { t: 1 } } as unknown as GhlWebhookBody)
    const e = events[0]
    expect(eventProblem(e as never)).toBeUndefined()
    expect(e?.kind === 'message' && e.message.ref.id).toBe('12345')
    expect(e?.kind === 'message' && e.message.chat.platformData).not.toHaveProperty('conversationId')
    const call = parseInbound({ ...CALL_INBOUND, callStatus: { x: 1 }, messageId: 9 } as unknown as GhlWebhookBody).events[0]
    expect(call?.kind === 'call' && call.event.id).toBe('9')
    expect(call?.kind === 'call' && typeof call.event.status).toBe('string')
  })
})
