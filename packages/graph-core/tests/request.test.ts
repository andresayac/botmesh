import { describe, it, expect } from 'vitest'
import { ProviderError, RateLimitedError } from '@botmesh/core'
import { graphRequest, DEFAULT_GRAPH_REQUEST_TIMEOUT_MS } from '../src/index.js'

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('graphRequest', () => {
  it('returns the parsed body of a successful call', async () => {
    const fetch = async () => json(200, { message_id: 'm1' })
    await expect(graphRequest<{ message_id: string }>('https://graph.test/v1/me/messages', { method: 'POST' }, { fetch })).resolves.toEqual({ message_id: 'm1' })
  })

  it('maps Graph errors to typed provider errors', async () => {
    const fetch = async () => json(400, { error: { code: 4, message: 'slow down' } }, { 'Retry-After': '2' })
    await expect(graphRequest('https://graph.test/x', {}, { fetch })).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('times out a request that never answers with a ProviderError (no URL or token in the message)', async () => {
    const fetch = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    const err = await graphRequest('https://graph.test/x?access_token=SECRET', {}, { fetch, timeoutMs: 20 }).then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/timed out after 20ms/)
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('wraps a transport failure in a ProviderError with the cause', async () => {
    const boom = new TypeError('fetch failed')
    const fetch = async () => { throw boom }
    const err = await graphRequest('https://graph.test/x', {}, { fetch }).then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).cause).toBe(boom)
  })

  it('defaults to a 60 s timeout', () => {
    expect(DEFAULT_GRAPH_REQUEST_TIMEOUT_MS).toBe(60_000)
  })
})
