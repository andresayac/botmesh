/**
 * Tiny seeded generator for property-style fuzzing of webhook parsers: no
 * dependencies, deterministic per seed so a failure is reproducible.
 */

export type Rng = () => number

/** mulberry32: a small, fast, seedable PRNG. */
export function rng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const int = (r: Rng, max: number): number => Math.floor(r() * max)
export const pick = <T>(r: Rng, items: readonly T[]): T => items[int(r, items.length)]!

const NASTY_STRINGS = [
  '', ' ', '0', '-1', 'NaN', 'null', 'undefined', 'true', '{}', '[]', '__proto__', 'constructor',
  '\u0000', '\r\n', '�', '\uD800', '😀👍🏽', 'é'.normalize('NFD'), '<script>', '%00', '../../etc/passwd',
  'https://169.254.169.254/latest', 'javascript:alert(1)', 'x'.repeat(5000), '9007199254740993', '1e309',
]

export function randomString(r: Rng): string {
  if (r() < 0.5) return pick(r, NASTY_STRINGS)
  const n = int(r, 40)
  let s = ''
  for (let i = 0; i < n; i++) s += String.fromCodePoint(r() < 0.8 ? 32 + int(r, 95) : int(r, 0x2ffff))
  return s
}

/** Any JSON-ish value, nested up to `depth`. */
export function randomValue(r: Rng, depth = 2): unknown {
  switch (int(r, depth > 0 ? 10 : 7)) {
    case 0: return null
    case 1: return r() < 0.5
    case 2: return pick(r, [0, -1, 1.5, Number.MAX_SAFE_INTEGER, 1e21, -0, 7247303576418566913])
    case 3: case 4: case 5: return randomString(r)
    case 6: return undefined
    case 7: case 8: return Array.from({ length: int(r, 4) }, () => randomValue(r, depth - 1))
    default: {
      const o: Record<string, unknown> = {}
      for (let i = int(r, 4); i > 0; i--) setOwn(o, randomString(r).slice(0, 12), randomValue(r, depth - 1))
      return o
    }
  }
}

/** Own data property, like JSON.parse creates (assigning `__proto__` would change the prototype instead). */
function setOwn(o: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(o, key, { value, writable: true, enumerable: true, configurable: true })
}

/** Deep-copy `value` and replace / delete / add a few random nodes. */
export function mutate(r: Rng, value: unknown, rounds = 1 + int(r, 3)): unknown {
  let out: unknown = structuredClone(value)
  for (let i = 0; i < rounds; i++) out = mutateOnce(r, out)
  return out
}

function mutateOnce(r: Rng, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || r() < 0.1) return r() < 0.5 ? randomValue(r) : value
  const container = value as Record<string, unknown>
  const keys = Object.keys(container)
  if (keys.length === 0 || r() < 0.15) {
    setOwn(container, r() < 0.5 ? randomString(r).slice(0, 12) : pick(r, ['__proto__', 'constructor', 'type', 'id']), randomValue(r))
    return container
  }
  const key = pick(r, keys)
  const roll = r()
  if (roll < 0.2) delete container[key]
  else if (roll < 0.6) setOwn(container, key, randomValue(r))
  else setOwn(container, key, mutateOnce(r, container[key]))
  return container
}

/** Random bytes, sometimes valid UTF-8 text, sometimes not. */
export function randomBytes(r: Rng): Buffer {
  if (r() < 0.5) return Buffer.from(randomString(r), 'utf8')
  return Buffer.from(Array.from({ length: int(r, 300) }, () => int(r, 256)))
}

/**
 * What the core relies on for every emitted event: opaque ids are strings, a
 * message body is a string and the timestamp a finite number. Returns the
 * first violation, or undefined.
 */
export function eventProblem(e: { kind: string; [k: string]: unknown }): string | undefined {
  const isStr = (v: unknown): boolean => typeof v === 'string'
  if (e.kind === 'message' || e.kind === 'interaction') {
    const m = (e.kind === 'message' ? e['message'] : e['interaction']) as Record<string, unknown>
    const ref = m['ref'] as Record<string, unknown> | undefined
    for (const field of ['chatId', 'senderId', 'from', 'sender'] as const) if (!isStr(m[field])) return `${e.kind}.${field} is ${typeof m[field]}`
    if (!(m['chatId'] as string)) return `${e.kind}.chatId is empty`
    if (!ref || !isStr(ref['id']) || !isStr(ref['chatId'])) return `${e.kind}.ref ids are not strings`
    if (e.kind === 'message' && !isStr(m['body'])) return `message.body is ${typeof m['body']}`
    if (e.kind === 'interaction' && !isStr(m['data'])) return `interaction.data is ${typeof m['data']}`
    if (!Number.isFinite(m['timestamp'])) return `${e.kind}.timestamp is not finite`
    const chat = m['chat'] as Record<string, unknown> | undefined
    if (chat && chat['id'] !== m['chatId']) return `${e.kind}.chat.id differs from chatId`
  }
  if (e.kind === 'status') {
    const s = e['status'] as Record<string, unknown>
    const ref = s['ref'] as Record<string, unknown>
    if (!isStr(ref['id']) || !(ref['id'] as string) || !isStr(ref['chatId'])) return 'status.ref ids are not strings'
    if (s['recipient'] !== undefined && !isStr(s['recipient'])) return 'status.recipient is not a string'
  }
  if (e.kind === 'reaction') {
    const r = e['reaction'] as Record<string, unknown>
    const ref = r['ref'] as Record<string, unknown>
    if (!isStr(ref['id']) || !isStr(ref['chatId']) || !isStr(r['emoji']) || !isStr(r['senderId'])) return 'reaction fields are not strings'
  }
  return undefined
}
