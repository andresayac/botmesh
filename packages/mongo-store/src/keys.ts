/**
 * Object keys MongoDB can store. BSON encodes a key as a NUL-terminated C string, so the driver
 * throws ("key ... must not contain null bytes") on any key holding U+0000 — and a flow whose
 * `c.state` (or a message's `raw`, an AI turn) is keyed by user text could then never be saved.
 * Such keys are written with U+FFFD instead, which is what PostgresStore stores for them.
 */

const NUL = /\u0000/g
const REPLACEMENT = '\ufffd'

/** A plain object or array, the only containers that are walked (Buffers, Dates, BSON types are left alone). */
function isPlain(value: object): boolean {
  if (Array.isArray(value)) return true
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * `value` with every U+0000 in a plain-object key (at any depth) replaced by U+FFFD. Returns the
 * same reference when there is nothing to replace, so the common case allocates nothing.
 */
export function bsonSafeKeys<T>(value: T): T {
  return walk(value, new Set()) as T
}

function walk(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object' || !isPlain(value) || seen.has(value)) return value
  seen.add(value) // a cycle is left for the driver to reject, as before
  try {
    if (Array.isArray(value)) {
      let out: unknown[] | undefined
      for (let i = 0; i < value.length; i++) {
        const next = walk(value[i], seen)
        if (next !== value[i]) (out ??= value.slice())[i] = next
      }
      return out ?? value
    }
    const source = value as Record<string, unknown>
    const entries = Object.keys(source).map((key) => [key, walk(source[key], seen)] as const)
    if (entries.every(([key, next]) => next === source[key] && !key.includes('\u0000'))) return value
    const out: Record<string, unknown> = {}
    for (const [key, next] of entries) {
      // Two keys differing only by NUL vs U+FFFD collapse into one (the later wins). defineProperty
      // keeps a literal "__proto__" key an own property.
      const safe = key.includes('\u0000') ? key.replace(NUL, REPLACEMENT) : key
      Object.defineProperty(out, safe, { value: next, enumerable: true, writable: true, configurable: true })
    }
    return out
  } finally {
    seen.delete(value)
  }
}
