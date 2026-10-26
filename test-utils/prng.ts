/**
 * Seeded pseudo-random generator for the property-style tests of the product packages
 * (mulberry32): the same seed always replays the same operation sequence, so a failure
 * prints a seed that reproduces it.
 */
export interface Rng {
  /** Integer in `[0, n)`. */
  int(n: number): number
  /** One element of `items`. */
  pick<T>(items: readonly T[]): T
  /** `true` with probability `p`. */
  chance(p: number): boolean
}

export function rng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
  }
}

/** The outcome of a call as comparable data: its value, or the error's name. */
export async function outcome<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() }
  } catch (error) {
    return { error: error instanceof Error ? error.name : String(error) }
  }
}
