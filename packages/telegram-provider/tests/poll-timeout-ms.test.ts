import { describe, it, expect, vi, afterEach } from 'vitest'
import { TelegramProvider } from '../src/index.js'

afterEach(() => vi.unstubAllGlobals())

async function firstLongPollTimeout(config: Record<string, unknown>): Promise<number> {
  const bodies: Array<{ url: string; body: Record<string, unknown> }> = []
  let rounds = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    bodies.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
    if (url.includes('/getUpdates')) rounds++
    const result = url.endsWith('/getMe') ? { id: 9, is_bot: true, first_name: 'B' } : []
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, result }) }
  }))
  const p = new TelegramProvider({ token: 'TOK', pollIdleMs: 1, ...config })
  await p.start()
  const t0 = Date.now()
  while (rounds < 2 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5))
  await p.stop()
  // The first round never long-polls (timeout 0); the second uses the configured timeout.
  return bodies.filter((b) => b.url.includes('/getUpdates'))[1]!.body.timeout as number
}

describe('Telegram pollTimeoutMs', () => {
  it('sets the getUpdates long-poll timeout in milliseconds (sent in whole seconds, rounded up)', async () => {
    expect(await firstLongPollTimeout({ pollTimeoutMs: 1500 })).toBe(2)
    expect(await firstLongPollTimeout({ pollTimeoutMs: 0 })).toBe(0)
  })

  it('keeps the deprecated pollTimeout (seconds) working', async () => {
    expect(await firstLongPollTimeout({ pollTimeout: 3 })).toBe(3)
  })

  it('rejects both options with different values, and invalid values', () => {
    expect(() => new TelegramProvider({ token: 'TOK', pollTimeout: 3, pollTimeoutMs: 5000 })).toThrow(/pollTimeoutMs/)
    expect(() => new TelegramProvider({ token: 'TOK', pollTimeout: 3, pollTimeoutMs: 3000 })).not.toThrow()
    expect(() => new TelegramProvider({ token: 'TOK', pollTimeoutMs: -1 })).toThrow(/pollTimeoutMs/)
  })
})
