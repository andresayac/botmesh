/**
 * Seeded property tests for the pure helpers: they parse gateway payloads (attacker-reachable
 * through the webhook), so they must never throw and must keep their invariants for any input.
 */
import { describe, expect, it } from 'vitest'

import { WaIdentityStore, describeErrorBody, normalizeJid, parseRetryAfter, resolveMedia, type IdentityPersistence } from '../src/index.js'

/** mulberry32: small deterministic PRNG so a failure is reproducible from its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = ['1', '2', '9', ':', '@', ' ', '\t', 'a', 'Z', '_', '.', 'lid', 's.whatsapp.net', 'c.us', 'g.us', '😀', 'ñ', '\u0000', '\n', '%', '/']

function randomString(rnd: () => number, max = 24): string {
  const n = Math.floor(rnd() * max)
  let s = ''
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)]
  return s
}

function randomValue(rnd: () => number, depth = 0): unknown {
  const r = rnd()
  if (r < 0.3) return randomString(rnd)
  if (r < 0.4) return Math.floor(rnd() * 1e6) - 5e5
  if (r < 0.45) return null
  if (r < 0.5) return undefined
  if (r < 0.55) return rnd() < 0.5
  if (depth > 3) return 'leaf'
  if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 4) }, () => randomValue(rnd, depth + 1))
  const o: Record<string, unknown> = {}
  for (const k of ['message', 'error', 'response', 'status', '__proto__', 'constructor']) if (rnd() < 0.4) {
    // Own data properties, as JSON.parse builds them (a plain `o.__proto__ =` would swap the prototype).
    Object.defineProperty(o, k, { value: randomValue(rnd, depth + 1), enumerable: true, writable: true, configurable: true })
  }
  return o
}

describe('normalizeJid (fuzz)', () => {
  it('never throws, is idempotent and never returns an empty string', () => {
    const rnd = prng(0xc0ffee)
    for (let i = 0; i < 5000; i++) {
      const input = rnd() < 0.9 ? randomString(rnd) : randomValue(rnd)
      const once = normalizeJid(input)
      if (once !== undefined) {
        expect(once).not.toBe('')
        expect(normalizeJid(once)).toBe(once)
      }
    }
  })

  it('strips a device suffix even when stacked', () => {
    expect(normalizeJid('57:1:2@s.whatsapp.net')).toBe('57@s.whatsapp.net')
  })

  it('runs in linear time on a long run of device-like suffixes that does not match', () => {
    const user = ':1'.repeat(100_000)
    const started = performance.now()
    expect(normalizeJid(`${user}x@s.whatsapp.net`)).toBe(`${user}x@s.whatsapp.net`)
    expect(normalizeJid(`57${user}@s.whatsapp.net`)).toBe('57@s.whatsapp.net')
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('WaIdentityStore (fuzz)', () => {
  it('links every alias of a resolve to the returned id and never throws', () => {
    const rnd = prng(42)
    const ids = new WaIdentityStore(Number.POSITIVE_INFINITY)
    for (let i = 0; i < 3000; i++) {
      const aliases = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => (rnd() < 0.8 ? randomString(rnd, 8) : randomValue(rnd)))
      const [primary, ...twins] = aliases
      const id = ids.resolve(primary, ...twins)
      const normalized = aliases.map(normalizeJid).filter((a): a is string => a !== undefined)
      if (normalized.length === 0) {
        expect(id).toBeUndefined()
        continue
      }
      expect(typeof id).toBe('string')
      for (const alias of normalized) expect(ids.lookup(alias)).toBe(id)
    }
  })

  it('keeps one id per person across reorderings, LRU eviction and restarts (with persistence)', () => {
    const rnd = prng(7)
    const people = Array.from({ length: 200 }, (_, i) => ({ pn: `57300${1000 + i}@s.whatsapp.net`, lid: `${9000 + i}@lid` }))
    const disk = new Map<string, string>()
    const persistence: IdentityPersistence = { get: (a) => disk.get(a), set: (a, c) => void disk.set(a, c) }
    let ids = new WaIdentityStore(16, persistence)
    const seen = new Map<number, string>()
    for (let i = 0; i < 20_000; i++) {
      if (rnd() < 0.002) ids = new WaIdentityStore(16, persistence) // restart
      const p = Math.floor(rnd() * people.length)
      const person = people[p]!
      // The first message carries both aliases (twin attached); afterwards any form, with device suffixes.
      const form = seen.has(p) ? Math.floor(rnd() * 4) : 0
      const dev = rnd() < 0.5 ? `:${Math.floor(rnd() * 30)}` : ''
      const lid = person.lid.replace('@', `${dev}@`)
      const pn = person.pn.replace('@', `${dev}@`)
      const id = form === 0 ? ids.resolve(lid, pn) : form === 1 ? ids.resolve(lid) : form === 2 ? ids.resolve(pn) : ids.resolve(pn, lid)
      const expected = seen.get(p) ?? id!
      seen.set(p, expected)
      expect(id).toBe(expected)
    }
    expect(seen.size).toBe(people.length)
  })
})

describe('parseRetryAfter (fuzz)', () => {
  it('returns undefined or a finite non-negative number', () => {
    const rnd = prng(99)
    for (let i = 0; i < 5000; i++) {
      const v = rnd() < 0.5 ? randomString(rnd) : String(JSON.stringify(randomValue(rnd)))
      const ms = parseRetryAfter(v)
      if (ms !== undefined) {
        expect(Number.isFinite(ms)).toBe(true)
        expect(ms).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('describeErrorBody (fuzz)', () => {
  it('never throws and stays within 300 characters', () => {
    const rnd = prng(1234)
    for (let i = 0; i < 5000; i++) {
      const out = describeErrorBody(randomValue(rnd))
      expect(typeof out).toBe('string')
      expect(out.length).toBeLessThanOrEqual(300)
    }
  })

  it('cuts a long message too', () => {
    expect(describeErrorBody({ message: 'x'.repeat(10_000) })).toHaveLength(300)
    expect(describeErrorBody({ response: { message: 'y'.repeat(10_000) } })).toHaveLength(300)
  })
})

describe('resolveMedia data: URIs', () => {
  it('decodes a base64 data: URI given as a string or { url } instead of reading it as a path', async () => {
    await expect(resolveMedia('image', 'data:image/png;base64,AQID')).resolves.toEqual({ base64: 'AQID', filename: undefined, mimetype: 'image/png' })
    await expect(resolveMedia('document', { url: 'data:application/pdf;base64,AQID' }, { filename: 'a.pdf' })).resolves.toEqual({ base64: 'AQID', filename: 'a.pdf', mimetype: 'application/pdf' })
  })
})
