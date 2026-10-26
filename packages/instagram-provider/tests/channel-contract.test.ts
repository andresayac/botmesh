/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) and the declared text limit.
 */
import { describe, it, expect, vi } from 'vitest'
import { assertCapabilityContract, assertPresenceWhileDisconnected, assertInboundContract } from '@botmesh/core/testing'
import { parseInbound, type IgWebhookBody } from '../src/parseInbound.js'
import { InstagramProvider } from '../src/InstagramProvider.js'

const page = (...messaging: unknown[]): IgWebhookBody => ({ object: 'page', entry: [{ id: 'PG', time: 1, messaging: messaging as never }] })

describe('InstagramProvider — channel contract', () => {
  it('passes the webhook epoch ms through and uses the receive time when it is missing', () => {
    const before = Date.now()
    const events = parseInbound(page(
      { sender: { id: 'U1' }, recipient: { id: 'PG' }, timestamp: 1_760_000_000_000, message: { mid: 'm1', text: 'hola' } },
      { sender: { id: 'U1' }, recipient: { id: 'PG' }, message: { mid: 'm2', text: 'sin hora' } },
      { sender: { id: 'U1' }, recipient: { id: 'PG' }, postback: { mid: 'pb', title: 'Start', payload: 'GO' } },
    ))
    expect(events.map((e) => e.kind)).toEqual(['message', 'message', 'interaction'])
    assertInboundContract(events)
    const second = events[1]
    expect(second?.kind === 'message' && second.message.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('declares the Send API text limit', () => {
    const p = new InstagramProvider({ accessToken: 'T', verifyToken: 'v', appSecret: 's' })
    expect(p.capabilities.maxTextLength).toBe(1000)
    expect(p.capabilities.maxTextBytes).toBe(1000) // the Send API counts UTF-8 bytes
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new InstagramProvider({ accessToken: 'T', verifyToken: 'v', appSecret: 's' }))
  })
})

describe('request timeout', () => {
  it('a Send API call that never answers rejects with a ProviderError after requestTimeoutMs', async () => {
    const { vi } = await import('vitest')
    const { ProviderError } = await import('@botmesh/core')
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    try {
      const p = new InstagramProvider({ accessToken: 'T', verifyToken: 'v', appSecret: 's', requestTimeoutMs: 20 })
      const err = await p.send('U1', { kind: 'text', text: 'hola' }).then(() => undefined, (e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as Error).message).toMatch(/timed out after 20ms/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects an invalid requestTimeoutMs', () => {
    expect(() => new InstagramProvider({ accessToken: 'T', verifyToken: 'v', appSecret: 's', requestTimeoutMs: 0 })).toThrow(/requestTimeoutMs/)
  })
})

describe('presence while disconnected', () => {
  it('markRead / typing resolve without contacting the transport before start()', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline: the transport must not be contacted') })
    try {
      await assertPresenceWhileDisconnected(new InstagramProvider({ accessToken: 'T', verifyToken: 'v', appSecret: 's' }), { chatId: 'chat-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
