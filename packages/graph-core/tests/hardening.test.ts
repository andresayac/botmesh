/**
 * Edge cases of untrusted Graph responses: Retry-After spellings, error codes
 * sent as strings, non-string messages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutsideSessionWindowError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import { readGraphResponse, toGraphError } from '../src/index.js'

const res = (status: number, body: unknown, retryAfter?: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
  json: async () => body,
})

const rateLimited = (retryAfter: string | undefined): Promise<RateLimitedError> =>
  readGraphResponse(res(429, { error: { code: 4, message: 'slow' } }, retryAfter)).then(
    () => { throw new Error('expected a rejection') },
    (e: unknown) => e as RateLimitedError,
  )

afterEach(() => { vi.useRealTimers() })

describe('readGraphResponse — Retry-After', () => {
  it('never yields a negative delay', async () => {
    const err = await rateLimited('-5')
    expect(err).toBeInstanceOf(RateLimitedError)
    expect(err.retryAfterMs).toBe(60_000)
  })

  it('honours "0" as retry now', async () => {
    expect((await rateLimited('0')).retryAfterMs).toBe(0)
  })

  it('accepts fractional and padded seconds', async () => {
    expect((await rateLimited(' 3 ')).retryAfterMs).toBe(3000)
    expect((await rateLimited('2.5')).retryAfterMs).toBe(2500)
  })

  it('parses the HTTP-date form', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T07:28:00Z') })
    expect((await rateLimited('Wed, 21 Oct 2026 07:28:30 GMT')).retryAfterMs).toBe(30_000)
    // A date in the past means "now".
    expect((await rateLimited('Wed, 21 Oct 2026 07:00:00 GMT')).retryAfterMs).toBe(0)
  })

  it('ignores garbage and falls back to the code default', async () => {
    expect((await rateLimited('soon')).retryAfterMs).toBe(60_000)
    expect((await rateLimited('')).retryAfterMs).toBe(60_000)
  })
})

describe('toGraphError — loosely typed error bodies', () => {
  it('maps a numeric string code like the number', () => {
    expect(toGraphError({ code: '131047' as unknown as number, message: 'm' })).toBeInstanceOf(OutsideSessionWindowError)
    expect(toGraphError({ code: '551' as unknown as number, error_subcode: '1545041' as unknown as number })).toBeInstanceOf(RecipientUnreachableError)
  })

  it('ignores a non-string message', () => {
    const err = toGraphError({ code: 131047, message: { nested: true } as unknown as string })
    expect(err.message).toMatch(/^Graph API error \(131047\)/)
  })

  it('treats a non-object error as a generic failure', async () => {
    const err = await readGraphResponse(res(400, { error: 'boom' })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
  })
})

describe('toGraphError — actionable hints for setup mistakes', () => {
  it('points an invalid token (190) at the access token', () => {
    const err = toGraphError({ code: 190, message: 'Invalid OAuth access token - Cannot parse access token' })
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.message).toMatch(/\(code 190\).*access token is invalid or expired/)
  })

  it('points an unknown object (100/33) at the configured ids', () => {
    const err = toGraphError({ code: 100, error_subcode: 33, message: "Unsupported post request. Object with ID '123' does not exist" })
    expect(err.message).toMatch(/\(code 100\/33\).*phone number id/)
  })
})
