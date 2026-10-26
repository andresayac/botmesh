/** Defects left open by the alpha exit review: no request timeout, lists cut silently. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError, UnsupportedContentError } from '@botmesh/core'
import { MessengerProvider } from '../src/MessengerProvider.js'
import { toOutbound, toOutboundMessages } from '../src/toOutbound.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('Send API timeout', () => {
  it('a request that never answers rejects with a typed ProviderError (no token in the message)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })))
    const p = new MessengerProvider({ accessToken: 'PAGE-TOKEN', verifyToken: 'v', allowUnsignedWebhooks: true, requestTimeoutMs: 30 })
    const err = await p.send('PSID', { kind: 'text', text: 'hola' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/timed out after 30ms/)
    expect((err as Error).message).not.toContain('PAGE-TOKEN')
    expect(() => new MessengerProvider({ accessToken: 'T', verifyToken: 'v', requestTimeoutMs: 0 })).toThrow(/requestTimeoutMs/)
  })
})

describe('limits are enforced, not cut silently', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: `B${i}` }))
  it('more than 3 buttons reject', () => {
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: many(4) })).toThrow(UnsupportedContentError)
    expect(() => toOutboundMessages({ kind: 'card', title: 't', buttons: many(4) })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: many(3) })).not.toThrow()
  })
  it('a list with more than 10 rows rejects', () => {
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ rows: many(11) }] })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ rows: many(10) }] })).not.toThrow()
  })
})
