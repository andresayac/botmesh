import { describe, expect, it } from 'vitest'
import { PayloadTooLargeError, RateLimitedError } from '@botmesh/core'
import { readGraphResponse } from '../src/index.js'

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

describe('readGraphResponse: oversized requests', () => {
  it('maps an HTTP 413 without a Graph error code to PayloadTooLargeError', async () => {
    await expect(readGraphResponse(response(413, {}))).rejects.toBeInstanceOf(PayloadTooLargeError)
  })

  it('maps an HTTP 413 with an unmapped Graph error to PayloadTooLargeError', async () => {
    const err = await readGraphResponse(response(413, { error: { message: 'Request entity too large', code: 1 } })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PayloadTooLargeError)
    expect((err as Error).message).toContain('Request entity too large')
  })

  it('keeps a specific Graph code ahead of the 413 status', async () => {
    const err = await readGraphResponse(response(413, { error: { message: 'slow down', code: 130429 } })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
  })
})
