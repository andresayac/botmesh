/**
 * Seeded, dependency-free fuzzing helpers for webhook/gateway parsers.
 *
 * `mutations(seed, samples, rounds)` yields structurally-similar variants of
 * recorded payloads with random nodes swapped for hostile values (wrong types,
 * nulls, prototype keys, huge strings, emoji…), so a parser test can assert it
 * never throws and only emits well-formed events. Same seed → same inputs.
 */

import { expect } from 'vitest'

/** Deterministic PRNG (LCG) returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s / 0x1_0000_0000
  }
}

const HOSTILE: readonly unknown[] = [
  null, undefined, 0, -1, 1e308, Number.NaN, '', 'x', '💥🧨', [], {}, [null], [1, 'a'],
  { _serialized: 5 }, true, false, 'constructor', '__proto__', 'toString', 'hasOwnProperty',
  { low: -5 }, '123@lid', '1-2@g.us', 'status@broadcast', 'x'.repeat(10_000),
]

/** Keys hostile values are also injected under (fields parsers commonly read). */
const INJECT_KEYS = [
  'type', 'id', 'mid', 'text', 'body', 'content', 'mentions', 'mentionedJid', 'mentionedJidList', 'attachments',
  'contextInfo', 'reaction', 'quotedMsg', 'sender', 'author', 'key', 'message', 'who', 'participants', 'timestamp',
  'entry', 'messaging', 'data', 'content_type', 'member', 'user', 'channel_id', 'postback', 'quick_reply',
]

export function mutate(value: unknown, rnd: () => number, rate = 0.12): unknown {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!
  if (rnd() < rate) return pick(HOSTILE)
  if (Array.isArray(value)) return value.map((v) => mutate(v, rnd, rate))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (rnd() < 0.05) continue
      out[k] = mutate(v, rnd, rate)
    }
    if (rnd() < 0.15) out[pick(INJECT_KEYS)] = pick(HOSTILE)
    return out
  }
  return value
}

/** `rounds` mutated deep copies of the samples, deterministic for a seed. */
export function* mutations<T>(seed: number, samples: readonly T[], rounds: number): Generator<unknown> {
  const rnd = seededRandom(seed)
  for (let i = 0; i < rounds; i++) {
    const sample = samples[Math.floor(rnd() * samples.length)]!
    yield mutate(structuredClone(sample), rnd)
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string'

/**
 * The shape the core relies on: opaque string ids, string bodies, a finite
 * timestamp and string types/kinds — never `undefined`, objects or functions
 * leaking from a malformed payload.
 */
export function expectWellFormedEvent(e: unknown): void {
  const ev = e as Record<string, any>
  expect(isStr(ev.kind)).toBe(true)
  if (ev.kind === 'message') {
    const m = ev.message
    expect([m.chatId, m.senderId, m.from, m.sender, m.ref?.id, m.ref?.chatId, m.body, m.type, m.chat?.id].every(isStr)).toBe(true)
    expect(m.chatId).not.toBe('')
    expect(Number.isFinite(m.timestamp)).toBe(true)
    expect(Array.isArray(m.mentions) && m.mentions.every(isStr)).toBe(true)
    if (m.quoted) expect(isStr(m.quoted.ref?.id) && isStr(m.quoted.ref?.chatId)).toBe(true)
    if (m.quoted?.body !== undefined) expect(isStr(m.quoted.body)).toBe(true)
    if (m.quoted?.senderId !== undefined) expect(isStr(m.quoted.senderId)).toBe(true)
    if (m.media) expect(isStr(m.media.kind) && (m.media.mimetype === undefined || isStr(m.media.mimetype))).toBe(true)
  } else if (ev.kind === 'interaction') {
    const i = ev.interaction
    expect([i.interactionId, i.chatId, i.senderId, i.data, i.kind, i.ref?.id].every(isStr)).toBe(true)
    expect(i.chatId).not.toBe('')
    expect(Number.isFinite(i.timestamp)).toBe(true)
  } else if (ev.kind === 'reaction') {
    const r = ev.reaction
    expect([r.ref?.id, r.ref?.chatId, r.emoji, r.senderId].every(isStr)).toBe(true)
    expect(typeof r.removed).toBe('boolean')
  } else if (ev.kind === 'status') {
    expect([ev.status.ref?.id, ev.status.ref?.chatId, ev.status.status].every(isStr)).toBe(true)
  }
}
