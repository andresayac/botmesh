/**
 * Property-style fuzzing of the inbound normalizer and the webhook entry point
 * with a small seeded generator (deterministic, no extra dependencies).
 */
import { describe, it, expect } from 'vitest'
import { parseUpdate } from '../src/parseInbound.js'
import { TelegramProvider } from '../src/TelegramProvider.js'
import type { TelegramUpdate } from '../src/types.js'

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STRINGS = ['', 'hola', '👍🏽 emoji', 'ﷺ‮ rtl', '\u0000', 'a'.repeat(5000), '__proto__', 'constructor', '-100123', '42']

function anyValue(r: () => number, depth: number): unknown {
  const pick = Math.floor(r() * 12)
  switch (pick) {
    case 0: return null
    case 1: return undefined
    case 2: return Math.floor(r() * 2e9) - 1e9
    case 3: return [Number.NaN, Infinity, -0, 1.5, 0][Math.floor(r() * 5)]
    case 4: return STRINGS[Math.floor(r() * STRINGS.length)]
    case 5: return r() < 0.5
    case 6: return depth > 0 ? Array.from({ length: Math.floor(r() * 3) }, () => anyValue(r, depth - 1)) : []
    case 7: return depth > 0 ? message(r, depth - 1) : {}
    case 8: return depth > 0 ? { id: anyValue(r, depth - 1), type: anyValue(r, depth - 1) } : {}
    default: return STRINGS[1]
  }
}

/** A message-ish object: plausible field names with random (often wrong-typed) values. */
function message(r: () => number, depth: number): Record<string, unknown> {
  const fields = ['message_id', 'ephemeral_message_id', 'date', 'edit_date', 'chat', 'from', 'sender_chat', 'text', 'caption',
    'entities', 'caption_entities', 'photo', 'document', 'audio', 'voice', 'video', 'sticker', 'location', 'venue', 'contact',
    'poll', 'reply_to_message', 'reply_to']
  const m: Record<string, unknown> = {}
  for (const f of fields) if (r() < 0.45) m[f] = anyValue(r, depth)
  // Usually give it a routable chat so the deeper paths run.
  if (r() < 0.8) m.chat = { id: r() < 0.9 ? Math.floor(r() * 1e6) : anyValue(r, 0), type: ['private', 'group', 'supergroup', 'channel', 7][Math.floor(r() * 5)] }
  return m
}

function update(r: () => number): unknown {
  const u: Record<string, unknown> = { update_id: Math.floor(r() * 1e9) }
  const kind = Math.floor(r() * 4)
  if (kind === 0) u.message = message(r, 3)
  else if (kind === 1) u.edited_message = message(r, 3)
  else if (kind === 2) u.callback_query = { id: anyValue(r, 1), from: anyValue(r, 2), data: anyValue(r, 1), message: anyValue(r, 2), inline_message_id: anyValue(r, 1) }
  else u[STRINGS[Math.floor(r() * STRINGS.length)]] = anyValue(r, 2)
  return u
}

describe('parseUpdate fuzzing', () => {
  it('never throws and only emits well-formed events (2000 seeded updates)', () => {
    const r = rng(0xb07)
    for (let i = 0; i < 2000; i++) {
      const u = update(r)
      let ev: ReturnType<typeof parseUpdate>
      try {
        ev = parseUpdate(u as TelegramUpdate, '9')
      } catch (err) {
        throw new Error(`parseUpdate threw on #${i}: ${(err as Error).message}\n${JSON.stringify(u, (_k, v) => (typeof v === 'string' && v.length > 40 ? v.slice(0, 40) : v))}`)
      }
      if (!ev) continue
      const base = ev.kind === 'message' ? ev.message : ev.kind === 'interaction' ? ev.interaction : undefined
      if (!base) continue
      for (const k of ['chatId', 'senderId', 'from', 'sender'] as const) {
        expect(typeof base[k], `#${i} ${k}`).toBe('string')
        expect(base[k], `#${i} ${k}`).not.toBe('')
      }
      expect(typeof base.ref.id).toBe('string')
      expect(base.ref.id).not.toBe('')
      expect(Number.isFinite(base.timestamp), `#${i} timestamp`).toBe(true)
      if (ev.kind === 'message') {
        expect(typeof ev.message.body, `#${i} body`).toBe('string')
        expect(Array.isArray(ev.message.mentions)).toBe(true)
        if (ev.message.quoted) {
          const q = ev.message.quoted
          if (q.body !== undefined) expect(typeof q.body).toBe('string')
        }
        if (ev.message.media?.token !== undefined) expect(typeof ev.message.media.token).toBe('string')
      } else if (ev.kind === 'interaction') {
        expect(typeof ev.interaction.data).toBe('string')
      }
    }
  })

  it('ingest() answers a status for every random body and never throws', () => {
    const p = new TelegramProvider({ token: 'T', polling: false, allowUnsignedWebhooks: true, selfId: '9', logger: { debug() {}, info() {}, warn() {}, error() {} } })
    const r = rng(42)
    for (let i = 0; i < 1000; i++) {
      const u = r() < 0.2 ? anyValue(r, 3) : update(r)
      const body = r() < 0.5 ? u : JSON.stringify(u) ?? 'undefined'
      const status = p.ingest(body)
      expect([200, 400]).toContain(status)
    }
  })
})
