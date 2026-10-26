import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { PayloadTooLargeError, ProviderError } from '@botmesh/core'
import { TikTokProvider } from '../src/TikTokProvider.js'

function make(fetch: typeof globalThis.fetch, extra: { maxBytes?: number; accessToken?: () => Promise<string> } = {}) {
  return new TikTokProvider({
    accessToken: extra.accessToken ?? 'ACCESS-SECRET',
    businessId: 'biz',
    appSecret: 's',
    selfUniqueIdentifier: 'self',
    logger: pino({ level: 'silent' }),
    http: { fetch, resolver: async () => ['93.184.216.34'], ...(extra.maxBytes ? { maxBytes: extra.maxBytes } : {}) },
  })
}
const down = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof globalThis.fetch

describe('TikTokProvider — transport failures are typed', () => {
  it('send rejects with a ProviderError when the request never gets a response', async () => {
    const err = await make(down).send('dm:c1', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/TikTok request failed/)
    expect((err as Error).message).not.toContain('ACCESS-SECRET')
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('typing and markRead reject with a ProviderError too', async () => {
    const p = make(down)
    await p.start()   // connected: presence hints reach the transport
    expect(await p.typing('dm:c1').catch((e: unknown) => e)).toBeInstanceOf(ProviderError)
    expect(await p.markRead([{ id: 'm', chatId: 'dm:c1' }]).catch((e: unknown) => e)).toBeInstanceOf(ProviderError)
  })

  it('a sticker download failure is a ProviderError that does not leak the URL query', async () => {
    const err = await make(down).downloadMedia({ kind: 'sticker', token: { url: 'https://cdn.example.com/s.webp?sig=SECRET' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('an oversized response becomes a PayloadTooLargeError', async () => {
    const big = (async () => new Response(new Uint8Array(64))) as unknown as typeof globalThis.fetch
    const err = await make(big, { maxBytes: 8 }).downloadMedia({ kind: 'sticker', token: { url: 'https://cdn.example.com/s.webp' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PayloadTooLargeError)
  })

  it('an access-token callback that throws rejects with a ProviderError carrying the cause', async () => {
    const ok = (async () => new Response(JSON.stringify({ code: 0, data: {} }))) as unknown as typeof globalThis.fetch
    const boom = new Error('refresh failed')
    const err = await make(ok, { accessToken: async () => { throw boom } }).send('dm:c1', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/access token/i)
    expect((err as { cause?: unknown }).cause).toBe(boom)
  })
})
