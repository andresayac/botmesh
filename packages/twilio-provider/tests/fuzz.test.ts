import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { TwilioProvider } from '../src/TwilioProvider.js'
import { computeTwilioSignature, parseFormParams } from '../src/signature.js'
import * as fx from './fixtures.js'
import { eventProblem, int, mutate, pick, randomBytes, randomString, rng } from './fuzz.js'

const URL_ = 'https://bot.example.com/twilio/webhook'
const FIXTURES = [fx.WA_TEXT, fx.WA_IMAGE, fx.WA_BUTTON, fx.WA_LOCATION, fx.WA_REPLY, fx.WA_BSUID_TEXT, fx.SMS_TEXT, fx.STATUS_DELIVERED, fx.STATUS_UNDELIVERED] as Array<Record<string, unknown>>
const KEYS = ['MessageSid', 'From', 'To', 'Body', 'NumMedia', 'MediaUrl0', 'MediaContentType0', 'MediaUrl9', 'MessageStatus', 'SmsStatus',
  'ButtonPayload', 'ListId', 'Latitude', 'Longitude', 'Label', 'Address', 'OriginalRepliedMessageSid', 'ErrorCode', 'ProfileName', 'WaId']

function harness(unsigned: boolean) {
  const provider = new TwilioProvider({
    accountSid: 'AC1', authToken: 'tok', whatsappFrom: 'whatsapp:+1', webhookUrl: URL_,
    allowUnsignedWebhooks: unsigned, logger: pino({ level: 'silent' }),
  })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e as InboundEvent) })
  return { provider, events }
}

function formOf(params: Record<string, unknown>): string {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const item of v) form.append(k, String(item))
    else if (v !== undefined) form.append(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))
  }
  return form.toString()
}

describe('TwilioProvider — fuzzed webhooks', () => {
  it('never throws and only emits well-formed events (signed form bodies)', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(seed)
      const { provider, events } = harness(false)
      const params = mutate(r, pick(r, FIXTURES)) as Record<string, unknown>
      if (params && typeof params === 'object' && r() < 0.5) params[pick(r, KEYS)] = randomString(r)
      const body = formOf(params && typeof params === 'object' ? params : {})
      const signature = computeTwilioSignature('tok', URL_, parseFormParams(body))
      let status = 0
      expect(() => { status = provider.ingest(Buffer.from(body), { 'x-twilio-signature': signature }) }, `seed ${seed}`).not.toThrow()
      expect(status, `seed ${seed}`).toBe(200)
      for (const e of events) expect(eventProblem(e), `seed ${seed}`).toBeUndefined()
    }
  })

  it('rejects random bytes, JSON and parsed objects without throwing', () => {
    for (let seed = 1; seed <= 800; seed++) {
      const r = rng(seed)
      const { provider, events } = harness(false)
      const body = pick(r, [randomBytes(r), JSON.stringify(mutate(r, pick(r, FIXTURES))), mutate(r, pick(r, FIXTURES)), int(r, 5), null])
      const headers = r() < 0.5 ? { 'x-twilio-signature': randomString(r), 'content-type': pick(r, ['application/json', 'text/plain', '']) } : undefined
      let status = 0
      expect(() => { status = provider.ingest(body, headers) }, `seed ${seed}`).not.toThrow()
      expect([400, 403], `seed ${seed}`).toContain(status)
      expect(events.filter((e) => e.kind !== 'connection'), `seed ${seed}`).toEqual([])
    }
  })

  it('unsigned mode tolerates any parsed body shape', () => {
    for (let seed = 1; seed <= 800; seed++) {
      const r = rng(seed)
      const { provider, events } = harness(true)
      let status = 0
      const body = mutate(r, pick(r, FIXTURES))
      expect(() => { status = provider.ingest(body) }, `seed ${seed}`).not.toThrow()
      expect([200, 400], `seed ${seed}`).toContain(status)
      for (const e of events) expect(eventProblem(e), `seed ${seed}`).toBeUndefined()
    }
  })
})
