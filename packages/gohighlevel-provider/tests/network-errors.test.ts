import { describe, it, expect } from 'vitest'
import { PayloadTooLargeError, ProviderError } from '@botmesh/core'
import { GoHighLevelProvider } from '../src/GoHighLevelProvider.js'
import { fakeHttp } from './support.js'
import type { ProviderHttpOptions } from '../src/http.js'

const down = () => fakeHttp(() => { throw new TypeError('fetch failed') }).http

describe('GoHighLevelProvider — transport failures are typed', () => {
  const make = (http: ProviderHttpOptions = down()) => new GoHighLevelProvider({ accessToken: 'tok-secret', locationId: 'loc1', http })

  it('send rejects with a ProviderError when the request never gets a response', async () => {
    const err = await make().send('contact1', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/HighLevel request failed/)
    expect((err as Error).message).not.toContain('tok-secret')
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('markRead rejects with a ProviderError too', async () => {
    const p = make()
    await p.start()   // connected: presence hints reach the transport
    const err = await p.markRead([{ id: 'm1', chatId: 'contact1', native: { conversationId: 'conv1' } }]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
  })

  it('downloadMedia rejects with a ProviderError and never leaks the URL query', async () => {
    const err = await make().downloadMedia({ kind: 'image', token: { url: 'https://cdn.example.com/a.png?sig=SECRET' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('an oversized response becomes a PayloadTooLargeError', async () => {
    const big = fakeHttp(() => ({ bytes: Buffer.alloc(64) }))
    const provider = make({ ...big.http, maxBytes: 8 })
    const err = await provider.downloadMedia({ kind: 'image', token: { url: 'https://cdn.example.com/a.png' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PayloadTooLargeError)
  })
})
