/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) and the declared text limit.
 */
import { describe, it, expect } from 'vitest'
import { assertCapabilityContract, assertInboundContract } from '@botmesh/core/testing'
import { parseInbound } from '../src/parseInbound.js'
import { GupshupProvider } from '../src/GupshupProvider.js'
import { fakeHttp } from './support.js'
import { BUTTON_REPLY, EV_DELIVERED, IMAGE, LOCATION, TEXT } from './fixtures.js'

const NOW = 1_760_000_000_123
const now = () => NOW

describe('Gupshup — channel contract', () => {
  it('emits epoch ms for messages, interactions and statuses', () => {
    const events = [TEXT, IMAGE, LOCATION, BUTTON_REPLY, EV_DELIVERED].flatMap((b) => parseInbound(b as never, now))
    expect(events.map((e) => e.kind)).toContain('status')
    assertInboundContract(events, { now: NOW })
  })

  it('converts an epoch-seconds callback time and replaces an invalid one with the receive time', () => {
    const [sec] = parseInbound({ ...TEXT, timestamp: 1_760_000_000 } as never, now)
    expect(sec?.kind === 'message' && sec.message.timestamp).toBe(1_760_000_000_000)
    const [neg] = parseInbound({ ...TEXT, timestamp: -5 } as never, now)
    expect(neg?.kind === 'message' && neg.message.timestamp).toBe(NOW)
  })

  it('declares the WhatsApp Business text limit', () => {
    const p = new GupshupProvider({ apiKey: 'k', appName: 'a', source: '1', allowUnsignedWebhooks: true })
    expect(p.capabilities.maxTextLength).toBe(4096)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new GupshupProvider({ apiKey: 'k', appName: 'a', source: '1', allowUnsignedWebhooks: true }))
  })
})

describe('Gupshup — list label', () => {
  it('labels the list button of degraded buttons with listButtonText (default "Opciones")', async () => {
    const { toOutbound } = await import('../src/toOutbound.js')
    const buttons = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, title: `T${i}` }))
    const label = (out: ReturnType<typeof toOutbound>) =>
      out.endpoint === 'msg' ? (out.message.globalButtons as Array<{ title: string }>)[0]?.title : undefined
    expect(label(toOutbound({ kind: 'buttons', text: 'x', buttons }))).toBe('Opciones')
    expect(label(toOutbound({ kind: 'buttons', text: 'x', buttons }, { listButtonText: 'Options' }))).toBe('Options')
  })

  it('the provider sends its listButtonText and rejects an empty one', async () => {
    const { calls, http } = fakeHttp(() => ({ json: { status: 'submitted', messageId: 'm1' } }))
    const p = new GupshupProvider({ apiKey: 'k', appName: 'a', source: '1', allowUnsignedWebhooks: true, listButtonText: 'Choose', http })
    await p.send('9', { kind: 'buttons', text: 'x', buttons: Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, title: `T${i}` })) })
    const message = JSON.parse(new URLSearchParams(calls[0]!.body).get('message') ?? '{}') as { globalButtons?: Array<{ title: string }> }
    expect(message.globalButtons?.[0]?.title).toBe('Choose')
    expect(() => new GupshupProvider({ apiKey: 'k', appName: 'a', source: '1', allowUnsignedWebhooks: true, listButtonText: '' })).toThrow(/listButtonText/)
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
