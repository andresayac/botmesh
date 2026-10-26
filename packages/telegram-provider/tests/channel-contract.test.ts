/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) and the declared text limit.
 */
import { describe, it, expect, vi } from 'vitest'
import { assertCapabilityContract, assertPresenceWhileDisconnected, assertInboundContract } from '@botmesh/core/testing'
import { parseUpdate } from '../src/parseInbound.js'
import { TelegramProvider } from '../src/TelegramProvider.js'

const chat = { id: 77, type: 'private' as const, first_name: 'Ana' }
const ana = { id: 77, is_bot: false, first_name: 'Ana' }

describe('Telegram — channel contract', () => {
  it('emits epoch ms for messages and callback queries', () => {
    const before = Date.now()
    const events = [
      parseUpdate({ update_id: 1, message: { message_id: 10, date: 1_760_000_000, from: ana, chat, text: 'hola' } }),
      parseUpdate({ update_id: 2, message: { message_id: 11, from: ana, chat, text: 'sin fecha' } as never }),
      parseUpdate({
        update_id: 3,
        callback_query: { id: 'cq', from: ana, chat_instance: 'ci', data: 'x', message: { message_id: 10, date: 1_600_000_000, chat } },
      } as never),
    ].filter((e) => e !== undefined)
    expect(events).toHaveLength(3)
    assertInboundContract(events)
    const click = events[2]
    expect(click?.kind === 'interaction' && click.interaction.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('declares the 4096-character text limit', () => {
    expect(new TelegramProvider({ token: '1:x' }).capabilities.maxTextLength).toBe(4096)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new TelegramProvider({ token: '1:x' }))
  })
})

describe('429 retry_after', () => {
  it('is clamped to a sane wait (a huge value would overflow setTimeout and spin the poll loop)', async () => {
    const { toTelegramError } = await import('../src/TelegramProvider.js')
    const { RateLimitedError } = await import('@botmesh/core')
    const huge = toTelegramError('c', 429, 'Too Many Requests', 1e12)
    expect(huge).toBeInstanceOf(RateLimitedError)
    expect((huge as InstanceType<typeof RateLimitedError>).retryAfterMs).toBe(86_400_000)
    expect((toTelegramError('c', 429, 'x', Number.NaN) as InstanceType<typeof RateLimitedError>).retryAfterMs).toBe(1000)
    expect((toTelegramError('c', 429, 'x', -3) as InstanceType<typeof RateLimitedError>).retryAfterMs).toBe(1000)
    expect((toTelegramError('c', 429, 'x', 7) as InstanceType<typeof RateLimitedError>).retryAfterMs).toBe(7000)
  })
})

describe('presence while disconnected', () => {
  it('markRead / typing resolve without contacting the transport before start()', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline: the transport must not be contacted') })
    try {
      await assertPresenceWhileDisconnected(new TelegramProvider({ token: '1:x' }), { chatId: 'chat-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
