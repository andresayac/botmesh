import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { TikTokProvider } from '../src/TikTokProvider.js'
import { parseWebhook } from '../src/parseInbound.js'
import type { TikTokWebhookBody } from '../src/types.js'
import * as fx from './fixtures/webhooks.js'
import { eventProblem, int, mutate, pick, randomBytes, randomString, rng, type Rng } from './fuzz.js'

const SECRET = 'app-secret'
const ENVELOPES = Object.values(fx)
  .filter((v): v is Record<string, unknown> | string => (typeof v === 'object' && v !== null) || (typeof v === 'string' && v.startsWith('{')))
  .map((v) => (typeof v === 'string' ? JSON.parse(v) as Record<string, unknown> : v))

/** Mutate the envelope and, inside it, the decoded `content` (TikTok sends it as a JSON string). */
function mutatedEnvelope(r: Rng): unknown {
  const base = structuredClone(pick(r, ENVELOPES))
  if (typeof base['content'] === 'string' && r() < 0.8) {
    const inner = mutate(r, JSON.parse(base['content']))
    base['content'] = r() < 0.8 ? (JSON.stringify(inner) ?? 'null') : inner
  }
  if (r() < 0.2) base['user_openid'] = r() < 0.5 ? fx.BUSINESS_ID : randomString(r)
  return r() < 0.3 ? mutate(r, base) : base
}

function harness() {
  const provider = new TikTokProvider({
    accessToken: 't', businessId: fx.BUSINESS_ID, appSecret: SECRET, selfUniqueIdentifier: fx.SELF_UID, logger: pino({ level: 'silent' }),
  })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e as InboundEvent) })
  return { provider, events }
}

const sign = (raw: string) => {
  const t = Math.floor(Date.now() / 1000)
  return { 'tiktok-signature': `t=${t},s=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}` }
}

describe('TikTokProvider — fuzzed webhooks', () => {
  it('never throws and only emits well-formed events (signed bodies)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const raw = JSON.stringify(mutatedEnvelope(r)) ?? 'null'
      let status = 0
      expect(() => { status = provider.ingest(Buffer.from(raw), sign(raw)) }, `seed ${seed}`).not.toThrow()
      expect([200, 400], `seed ${seed}`).toContain(status)
      for (const e of events) expect(eventProblem(e), `seed ${seed}`).toBeUndefined()
    }
  })

  it('parseWebhook tolerates any value', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed)
      const body = mutatedEnvelope(r) as TikTokWebhookBody
      let out: ReturnType<typeof parseWebhook> = []
      expect(() => { out = parseWebhook(body, { selfUniqueIdentifier: fx.SELF_UID }) }, `seed ${seed}`).not.toThrow()
      for (const e of out) expect(eventProblem(e as never), `seed ${seed}`).toBeUndefined()
    }
  })

  it('rejects random bodies and signatures without throwing', () => {
    for (let seed = 1; seed <= 800; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const body = pick(r, [randomBytes(r), JSON.stringify(mutatedEnvelope(r)), mutatedEnvelope(r), int(r, 3), null])
      const headers = pick(r, [undefined, { 'tiktok-signature': randomString(r) }, { 'tiktok-signature': `t=${int(r, 2e9)},s=${randomString(r)}` }, { 'tiktok-signature': ['t=1,s=00'] }])
      let status = 0
      expect(() => { status = provider.ingest(body, headers) }, `seed ${seed}`).not.toThrow()
      expect([400, 403], `seed ${seed}`).toContain(status)
      expect(events.filter((e) => e.kind !== 'connection'), `seed ${seed}`).toEqual([])
    }
  })
})

describe('TikTokProvider — hostile shapes', () => {
  it('numeric ids become strings and non-string text is dropped', () => {
    const [e] = parseWebhook(fx.envelope('im_receive_msg', {
      conversation_id: 42, message_id: 7, unique_identifier: 99, type: 'text', text: { body: { x: 1 } }, from: ['x'],
    }) as TikTokWebhookBody)
    expect(eventProblem(e as never)).toBeUndefined()
    expect(e?.kind === 'message' && [e.message.chatId, e.message.senderId, e.message.ref.id, e.message.body]).toEqual(['dm:42', '99', '7', ''])
  })

  it('a reaction field that is not an array yields no events instead of throwing', () => {
    expect(parseWebhook(fx.envelope('im_receive_msg', {
      conversation_id: 'c', message_id: 'm', unique_identifier: 'u', type: 'reaction', reaction: { original_msg_id: 'x' },
    }) as TikTokWebhookBody)).toEqual([])
  })
})
