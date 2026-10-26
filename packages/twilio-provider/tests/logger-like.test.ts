/**
 * `logger` takes any core `LoggerLike` (pino still accepted): a plain object or `console`
 * constructs the provider and receives its log lines.
 */
import { describe, expect, it, vi } from 'vitest'
import type { LoggerLike } from '@botmesh/core'
import { TwilioProvider } from '../src/TwilioProvider.js'

describe('TwilioProvider logger', () => {
  it('accepts a plain LoggerLike and console', () => {
    const spy = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const base = { accountSid: 'AC1', authToken: 'tok', whatsappFrom: 'whatsapp:+14155238886', webhookUrl: 'https://bot.example.com/hook' }
    expect(new TwilioProvider({ ...base, logger: spy })).toBeInstanceOf(TwilioProvider)
    const consoleLike: LoggerLike = console
    expect(new TwilioProvider({ ...base, logger: consoleLike })).toBeInstanceOf(TwilioProvider)
  })
})

describe('TwilioProvider logs carry no personal data', () => {
  it('typing failures are logged without the phone number or the API error text', async () => {
    const lines: unknown[] = []
    const spy = { debug: (...a: unknown[]) => { lines.push(a) }, info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    let fail: 'http' | 'network' = 'http'
    const fetch = (async () => {
      if (fail === 'network') throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ code: 21211, message: "The 'To' number +573001112233 is not valid" }), { status: 400 })
    }) as unknown as typeof globalThis.fetch
    const provider = new TwilioProvider({
      accountSid: 'AC1', authToken: 'tok', webhookUrl: 'https://bot.example.com/hook', allowUnsignedWebhooks: true, logger: spy,
      http: { fetch, resolver: async () => ['93.184.216.34'] },
    })
    const chat = 'whatsapp:+573001112233'
    await provider.start()
    provider.ingest({ MessageSid: `SM${'a'.repeat(32)}`, From: chat, To: 'whatsapp:+1', Body: 'hi' })
    await provider.typing(chat)
    const other = 'whatsapp:+573009998877'
    provider.ingest({ MessageSid: `SM${'b'.repeat(32)}`, From: other, To: 'whatsapp:+1', Body: 'hi' })
    fail = 'network'
    await provider.typing(other)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const text = JSON.stringify(lines)
    expect(text).not.toContain('573001112233')
    expect(text).not.toContain('573009998877')
  })
})
