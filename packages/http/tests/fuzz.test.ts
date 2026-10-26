/**
 * Property-style checks with a seeded generator (deterministic, no extra deps):
 * every encoding of a private IPv4 address that a URL can carry must be
 * blocked, and random public addresses must stay usable.
 */
import { describe, expect, it } from 'vitest'
import { assertSafeTarget, isAllowedHostUrl, isPrivateAddress } from '../src/index.js'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const byte = (r: () => number) => Math.floor(r() * 256)

/** A random address inside a private / special-purpose IPv4 range. */
function privateIpv4(r: () => number): [number, number, number, number] {
  const ranges: Array<() => [number, number, number, number]> = [
    () => [10, byte(r), byte(r), byte(r)],
    () => [127, byte(r), byte(r), byte(r)],
    () => [172, 16 + Math.floor(r() * 16), byte(r), byte(r)],
    () => [192, 168, byte(r), byte(r)],
    () => [169, 254, byte(r), byte(r)],
    () => [100, 64 + Math.floor(r() * 64), byte(r), byte(r)],
    () => [0, byte(r), byte(r), byte(r)],
    () => [224 + Math.floor(r() * 32), byte(r), byte(r), byte(r)],
  ]
  return ranges[Math.floor(r() * ranges.length)]!()
}

const hex = (a: number, b: number) => ((a << 8) | b).toString(16)

/** URL spellings of one IPv4 address (WHATWG URL normalizes them all). */
function spellings([a, b, c, d]: number[]): string[] {
  const n = ((a! << 24) >>> 0) + (b! << 16) + (c! << 8) + d!
  return [
    `${a}.${b}.${c}.${d}`,
    String(n), // single decimal integer
    `0x${n.toString(16)}`, // single hex integer
    `0${a!.toString(8)}.${b}.${c}.${d}`, // octal first octet
    `${a}.${(b! << 16) + (c! << 8) + d!}`, // a.bcd shorthand
    `[::ffff:${a}.${b}.${c}.${d}]`,
    `[::ffff:${hex(a!, b!)}:${hex(c!, d!)}]`,
    `[::${a}.${b}.${c}.${d}]`,
    `[64:ff9b::${a}.${b}.${c}.${d}]`,
    `[2002:${hex(a!, b!)}:${hex(c!, d!)}::1]`,
  ]
}

describe('@botmesh/http — seeded SSRF fuzz', () => {
  it('blocks every URL spelling of private IPv4 addresses', async () => {
    const r = rng(0xb07)
    for (let i = 0; i < 300; i++) {
      for (const host of spellings(privateIpv4(r))) {
        const url = new URL(`https://${host}/x`)
        // The resolver echoes the literal, as the system resolver does for an IP.
        await expect(
          assertSafeTarget(url, { resolver: async (h) => [h.replace(/^\[|\]$/g, '')] }),
          `${host} → ${url.hostname}`,
        ).rejects.toMatchObject({ code: 'UNSAFE_HOST' })
      }
    }
  })

  it('accepts random public IPv4 addresses', () => {
    const r = rng(42)
    let checked = 0
    while (checked < 500) {
      const ip = [1 + Math.floor(r() * 222), byte(r), byte(r), byte(r)]
      const [a, b] = ip
      const special = a === 10 || a === 127 || a === 0 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254)
        || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19))
      if (special) continue
      expect(isPrivateAddress(ip.join('.')), ip.join('.')).toBe(false)
      checked++
    }
  })

  it('never lets a look-alike host through the allow-list', () => {
    const r = rng(7)
    const tricks = [
      (h: string) => `https://${h}.evil.test/`,
      (h: string) => `https://evil-${h}/`,
      (h: string) => `https://evil.test/${h}`,
      (h: string) => `https://evil.test#.${h}`,
      (h: string) => `https://${h}@evil.test/`,
      (h: string) => `https://evil.test\\@${h}/`,
      (h: string) => `https://evil.test?.${h}`,
      (h: string) => `http://${h}/`,
      (h: string) => `https://user:pw@${h}/`,
    ]
    for (let i = 0; i < 200; i++) {
      const host = ['fbcdn.net', 'fbsbx.com', 'cdninstagram.com'][Math.floor(r() * 3)]!
      const url = tricks[Math.floor(r() * tricks.length)]!(host)
      expect(isAllowedHostUrl(url, { hosts: ['fbcdn.net', 'fbsbx.com', 'cdninstagram.com'] }), url).toBe(false)
    }
  })
})
