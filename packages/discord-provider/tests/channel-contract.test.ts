/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) and the declared text limit.
 */
import { describe, it, expect, vi } from 'vitest'
import { assertCapabilityContract, assertPresenceWhileDisconnected, assertInboundContract } from '@botmesh/core/testing'
import { parseDispatch } from '../src/parseInbound.js'
import { DiscordProvider } from '../src/DiscordProvider.js'

describe('Discord — channel contract', () => {
  it('emits epoch ms for messages (ISO time or snowflake) and interactions', () => {
    const author = { id: 'U1', username: 'ana' }
    const events = [
      parseDispatch('MESSAGE_CREATE', { id: '1234567890123456789', channel_id: 'C1', author, content: 'hola', timestamp: '2025-10-01T10:00:00.000Z', mentions: [], attachments: [] }, null),
      parseDispatch('MESSAGE_CREATE', { id: '1234567890123456790', channel_id: 'C1', author, content: 'sin hora', mentions: [], attachments: [] }, null),
      parseDispatch('INTERACTION_CREATE', {
        id: '1234567890123456791', type: 3, token: 'T', channel_id: 'C1', member: { user: author },
        data: { custom_id: 'x', component_type: 2 }, message: { id: 'M9' },
      }, null),
    ]
    expect(events.every((e) => e !== undefined)).toBe(true)
    assertInboundContract(events.filter((e) => e !== undefined))
  })

  it('declares the 2000-character message limit', () => {
    expect(new DiscordProvider({ token: 'T' }).capabilities.maxTextLength).toBe(2000)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new DiscordProvider({ token: 'T' }))
  })
})

describe('local media path that cannot be read', () => {
  it('rejects with UnsupportedContentError (cause: the fs error), not a raw ENOENT', async () => {
    const { UnsupportedContentError } = await import('@botmesh/core')
    const missing = 'C:/definitely/missing/botmesh-photo.png'
    for (const media of [missing, { path: missing }]) {
      const err = await new DiscordProvider({ token: 'T' }).send('C1', { kind: 'image', media }).then(() => undefined, (e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toContain('botmesh-photo.png')
      expect(((err as Error).cause as { code?: string } | undefined)?.code).toBe('ENOENT')
    }
  })
})

describe('request timeout', () => {
  it('a REST call that never answers rejects with a ProviderError after requestTimeoutMs', async () => {
    const { vi } = await import('vitest')
    const { ProviderError } = await import('@botmesh/core')
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    try {
      const p = new DiscordProvider({ token: 'SECRET-TOKEN', requestTimeoutMs: 20 })
      const err = await p.send('C1', { kind: 'text', text: 'hola' }).then(() => undefined, (e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as Error).message).toMatch(/timed out after 20ms/)
      expect((err as Error).message).not.toContain('SECRET-TOKEN')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects an invalid requestTimeoutMs', () => {
    expect(() => new DiscordProvider({ token: 'T', requestTimeoutMs: -1 })).toThrow(/requestTimeoutMs/)
  })
})

describe('429 retry_after', () => {
  it('is capped at 24 h like the other channels', async () => {
    const { toProviderError } = await import('../src/restClient.js')
    const { RateLimitedError } = await import('@botmesh/core')
    const err = toProviderError('C1', 429, { message: 'slow', retry_after: 1e12 })
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as InstanceType<typeof RateLimitedError>).retryAfterMs).toBe(86_400_000)
  })
})

describe('presence while disconnected', () => {
  it('markRead / typing resolve without contacting the transport before start()', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline: the transport must not be contacted') })
    try {
      await assertPresenceWhileDisconnected(new DiscordProvider({ token: 'T' }), { chatId: 'chat-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
