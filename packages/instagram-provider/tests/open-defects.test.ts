/** Defects left open by the alpha exit review: no request timeout, quick replies cut silently. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError, UnsupportedContentError } from '@botmesh/core'
import { InstagramProvider } from '../src/InstagramProvider.js'
import { toOutbound } from '../src/toOutbound.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('Send API timeout', () => {
  it('a request that never answers rejects with a typed ProviderError (no token in the message)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })))
    const p = new InstagramProvider({ accessToken: 'PAGE-TOKEN', verifyToken: 'v', allowUnsignedWebhooks: true, requestTimeoutMs: 30 })
    const err = await p.send('IGSID', { kind: 'text', text: 'hola' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/timed out after 30ms/)
    expect((err as Error).message).not.toContain('PAGE-TOKEN')
    expect(() => new InstagramProvider({ accessToken: 'T', verifyToken: 'v', requestTimeoutMs: -1 })).toThrow(/requestTimeoutMs/)
  })
})

describe('quick replies', () => {
  it('more than 13 reject instead of being cut', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: `B${i}` }))
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: many(14) })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: many(13) })).not.toThrow()
  })
})
