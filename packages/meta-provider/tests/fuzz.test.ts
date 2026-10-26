/**
 * Seeded property-style fuzzing of the webhook ingest (no extra deps): random,
 * malformed and hostile webhook bodies must never throw, must answer 200/400/403,
 * and every emitted event must respect the core's types and id contract.
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import type { InboundEvent } from '@botmesh/core'
import { CloudAPIProvider } from '../src/CloudAPIProvider.js'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const SCALARS: unknown[] = [
  undefined, null, '', ' ', 'x', '573001112233', 'US.13491208655302741918', 'US.ENT.11815799212886844830',
  42, -1, 1e308, true, {}, [], 'a b', '😀👩‍💻', '\u0000', 'NaN', '1700000000', { body: 'nested' }, ['arr'],
  '__proto__', { __proto__: { polluted: true } }, 'x'.repeat(300),
]
const KEYS = ['body', 'id', 'from', 'type', 'text', 'emoji', 'caption', 'message_id', 'name', 'address', 'latitude',
  'longitude', 'payload', 'title', 'response_json', 'voice', 'mime_type', 'filename', 'formatted_name', 'wa_id', 'user_id']
const TYPES: unknown[] = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'button',
  'interactive', 'reaction', 'system', 'unsupported', 42, undefined]

function generator(seed: number) {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const value = (depth = 0): unknown => {
    if (depth > 2 || r() < 0.5) return pick(SCALARS)
    if (r() < 0.5) return Object.fromEntries(Array.from({ length: Math.floor(r() * 4) }, () => [pick(KEYS), value(depth + 1)]))
    return Array.from({ length: Math.floor(r() * 3) }, () => value(depth + 1))
  }
  const maybe = (p: number, v: () => unknown) => (r() < p ? v() : value())
  const message = () => ({
    from: maybe(0.8, () => pick(['573001112233', 'US.13491208655302741918'])),
    from_user_id: r() < 0.3 ? pick(SCALARS) : undefined,
    id: maybe(0.9, () => pick(['wamid.1', 'wamid.2', 'wamid.3'])),
    timestamp: maybe(0.7, () => '1700000000'),
    type: pick(TYPES),
    text: maybe(0.5, () => ({ body: pick(SCALARS) })),
    image: value(), video: value(), audio: value(), document: value(), sticker: value(),
    location: maybe(0.5, () => ({ latitude: pick(SCALARS), longitude: pick(SCALARS), name: pick(SCALARS) })),
    contacts: value(), button: value(), context: value(), system: value(),
    reaction: maybe(0.5, () => ({ message_id: pick(SCALARS), emoji: pick(SCALARS) })),
    interactive: maybe(0.5, () => ({
      type: pick(['button_reply', 'list_reply', 'nfm_reply', 'other']),
      button_reply: value(), list_reply: value(),
      nfm_reply: { response_json: pick(['{"flow_token":"t","a":1}', '[]', 'null', '{', '{"__proto__":{"x":1}}']) },
    })),
  })
  const body = () => ({
    object: maybe(0.9, () => 'whatsapp_business_account'),
    entry: maybe(0.9, () => [{
      id: '1',
      changes: [{
        field: 'messages',
        value: maybe(0.9, () => ({
          contacts: maybe(0.5, () => [{ wa_id: pick(SCALARS), user_id: pick(SCALARS), profile: value() }]),
          messages: Array.from({ length: 1 + Math.floor(r() * 3) }, message),
          statuses: maybe(0.4, () => [{
            id: pick(SCALARS), status: pick(['sent', 'delivered', 'read', 'failed', 'deleted']), recipient_id: pick(SCALARS),
            timestamp: pick(SCALARS), errors: value(), pricing: value(), conversation: value(),
          }]),
          user_id_update: r() < 0.2 ? value() : undefined,
        })),
      }],
    }]),
  })
  return { r, body }
}

function checkEvent(e: InboundEvent): string | undefined {
  const nonEmpty = (v: unknown) => typeof v === 'string' && v.length > 0
  switch (e.kind) {
    case 'message': {
      const m = e.message
      if (typeof m.body !== 'string') return 'message.body is not a string'
      if (!nonEmpty(m.chatId) || m.chatId !== m.senderId || m.chatId !== m.from) return 'message ids'
      if (!nonEmpty(m.ref.id)) return 'message.ref.id empty'
      if (!Number.isFinite(m.timestamp)) return 'message.timestamp not finite'
      if (m.media && ![m.media.token, m.media.mimetype, m.media.filename].every((v) => v === undefined || nonEmpty(v))) return 'media fields'
      if (m.location && !(Number.isFinite(m.location.latitude) && Number.isFinite(m.location.longitude))) return 'location'
      return undefined
    }
    case 'interaction':
      if (typeof e.interaction.data !== 'string' || !nonEmpty(e.interaction.chatId)) return 'interaction fields'
      return Number.isFinite(e.interaction.timestamp) ? undefined : 'interaction.timestamp'
    case 'reaction':
      return typeof e.reaction.emoji === 'string' && nonEmpty(e.reaction.ref.id) && nonEmpty(e.reaction.senderId) ? undefined : 'reaction fields'
    case 'status':
      return Number.isFinite(e.status.timestamp) && nonEmpty(e.status.ref.chatId) ? undefined : 'status fields'
    default:
      return undefined
  }
}

const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } } as never

describe('CloudAPIProvider.ingest fuzz', () => {
  it.each([1, 7, 99, 2026])('seed %i: never throws, answers 200/400 and emits well-typed events', (seed) => {
    const { r, body } = generator(seed)
    const provider = new CloudAPIProvider({ accessToken: 't', phoneNumberId: '1', verifyToken: 'v', allowUnsignedWebhooks: true, logger: silent })
    const problems: string[] = []
    provider.onEvent((e) => { const p = checkEvent(e); if (p) problems.push(`${p}: ${JSON.stringify(e).slice(0, 200)}`) })
    for (let i = 0; i < 1500; i++) {
      const b = body()
      const status = provider.ingest(r() < 0.5 ? JSON.stringify(b) : b)
      expect([200, 400]).toContain(status)
    }
    expect(problems).toEqual([])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects random and tampered bytes when a secret is set', () => {
    const r = rng(5)
    const secret = 'app-secret'
    const provider = new CloudAPIProvider({ accessToken: 't', phoneNumberId: '1', verifyToken: 'v', appSecret: secret, logger: silent })
    let emitted = 0
    provider.onEvent(() => { emitted++ })
    for (let i = 0; i < 500; i++) {
      const bytes = Buffer.from(Array.from({ length: Math.floor(r() * 200) }, () => Math.floor(r() * 256)))
      const good = 'sha256=' + createHmac('sha256', secret).update(bytes).digest('hex')
      const tampered = Buffer.from(bytes)
      if (tampered.length) tampered[Math.floor(r() * tampered.length)] ^= 1 + Math.floor(r() * 255)
      const headers = { 'x-hub-signature-256': r() < 0.5 ? good : good.slice(0, 20) }
      expect(provider.ingest(tampered.length ? tampered : Buffer.from('x'), headers)).toBe(403)
      expect([200, 400]).toContain(provider.ingest(bytes, { 'x-hub-signature-256': good }))
    }
    expect(emitted).toBe(0)
  })
})
