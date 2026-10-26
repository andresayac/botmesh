/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) and the declared text limit.
 */
import { describe, it, expect, vi } from 'vitest'
import { assertCapabilityContract, assertPresenceWhileDisconnected, assertInboundContract } from '@botmesh/core/testing'
import { parseInbound } from '../src/parseInbound.js'
import { TwilioProvider, TWILIO_MAX_BODY } from '../src/TwilioProvider.js'
import { SMS_TEXT, STATUS_DELIVERED, WA_BUTTON, WA_IMAGE, WA_LOCATION, WA_TEXT } from './fixtures.js'

describe('Twilio — channel contract', () => {
  it('stamps every event with the receive time in epoch ms (Twilio sends none)', () => {
    const events = [WA_TEXT, WA_IMAGE, WA_BUTTON, WA_LOCATION, SMS_TEXT, STATUS_DELIVERED].flatMap((p) => parseInbound(p).events)
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['message', 'interaction', 'status']))
    assertInboundContract(events)
  })

  it('declares the 1600-character body limit', () => {
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 't' })
    expect(TWILIO_MAX_BODY).toBe(1600)
    expect(p.capabilities.maxTextLength).toBe(1600)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new TwilioProvider({ accountSid: 'AC1', authToken: 't' }))
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

describe('presence while disconnected', () => {
  it('markRead / typing resolve without contacting the transport before start()', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline: the transport must not be contacted') })
    try {
      await assertPresenceWhileDisconnected(new TwilioProvider({ accountSid: 'AC1', authToken: 't' }), { chatId: 'chat-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
