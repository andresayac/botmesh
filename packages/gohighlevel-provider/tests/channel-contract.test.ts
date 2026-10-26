/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`).
 */
import { describe, it, expect } from 'vitest'
import { assertCapabilityContract, assertInboundContract } from '@botmesh/core/testing'
import { GoHighLevelProvider } from '../src/GoHighLevelProvider.js'
import { parseInbound } from '../src/parseInbound.js'
import { SMS_INBOUND, WHATSAPP_IMAGE } from './fixtures.js'

describe('GoHighLevel — channel contract', () => {
  it('converts dateAdded to epoch ms and falls back to the receive time', () => {
    const before = Date.now()
    const events = [SMS_INBOUND, WHATSAPP_IMAGE, { ...SMS_INBOUND, messageId: 'm-2', dateAdded: 'not a date' }]
      .flatMap((b) => parseInbound(b as never).events)
    expect(events).toHaveLength(3)
    assertInboundContract(events)
    const first = events[0]
    expect(first?.kind === 'message' && first.message.timestamp).toBe(Date.parse('2021-04-21T11:31:45.750Z'))
    const last = events[2]
    expect(last?.kind === 'message' && last.message.timestamp).toBeGreaterThanOrEqual(before)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new GoHighLevelProvider({ accessToken: 'pit', locationId: 'loc', allowUnsignedWebhooks: true } as never))
  })
})

describe('Retry-After', () => {
  it('is capped at 24 h like the other channels (a huge value would overflow setTimeout)', async () => {
    const { retryAfterMs } = await import('../src/http.js')
    expect(retryAfterMs(new Headers({ 'retry-after': '99999999999' }))).toBe(86_400_000)
    expect(retryAfterMs(new Headers({ 'retry-after': '7' }))).toBe(7000)
    expect(retryAfterMs(new Headers())).toBeUndefined()
  })
})
