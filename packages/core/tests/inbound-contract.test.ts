import { describe, expect, it, vi } from 'vitest'
import {
  assertInboundContract,
  checkInboundContract,
  createTestBot,
  InboundContractError,
  MockProvider,
  recordEvents,
} from '../src/testing/index.js'
import type { InboundEvent, InboundInteraction, InboundMessage } from '../src/core/provider.js'
import { Bot } from '../src/index.js'

const NOW = 1_760_000_000_000 // 2025-10-09

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    ref: { id: 'm1', chatId: 'u1' },
    chat: { id: 'u1', kind: 'dm', isGroup: false, isBroadcast: false },
    senderInfo: { id: 'u1' },
    from: 'u1', sender: 'u1', chatId: 'u1', senderId: 'u1',
    isGroup: false, isBroadcast: false, fromMe: false,
    type: 'text', body: 'hola', timestamp: NOW - 1000, mentions: [], raw: {},
    ...over,
  }
}

function click(over: Partial<InboundInteraction> = {}): InboundInteraction {
  return {
    interactionId: 'it-1',
    ref: { id: 'menu', chatId: 'u1' },
    chat: { id: 'u1', kind: 'dm', isGroup: false, isBroadcast: false },
    senderInfo: { id: 'u1' },
    from: 'u1', sender: 'u1', chatId: 'u1', senderId: 'u1',
    isGroup: false, kind: 'button', data: 'ok', timestamp: NOW, raw: {},
    ...over,
  }
}

const rules = (events: Parameters<typeof checkInboundContract>[0]) =>
  checkInboundContract(events, { now: NOW }).map((v) => v.rule)

describe('checkInboundContract', () => {
  it('accepts epoch-ms messages, interactions and statuses', () => {
    const events: InboundEvent[] = [
      { kind: 'message', message: msg() },
      { kind: 'interaction', interaction: click({ respondBy: NOW + 3000 }) },
      { kind: 'status', status: { ref: { id: 'o1', chatId: 'u1' }, status: 'read', timestamp: NOW } },
      { kind: 'connection', update: { state: 'ready' } },
    ]
    expect(rules(events)).toEqual([])
  })

  it('flags epoch seconds, a missing time and a far-future time', () => {
    expect(rules([msg({ timestamp: 1_760_000_000 })])).toEqual(['timestamp-unit'])
    expect(rules([msg({ timestamp: 0 })])).toEqual(['timestamp-missing'])
    expect(rules([msg({ timestamp: Number.NaN })])).toEqual(['timestamp-missing'])
    expect(rules([msg({ timestamp: NOW + 2 * 86_400_000 })])).toEqual(['timestamp-future'])
    expect(rules([msg({ timestamp: NOW + 0.5 })])).toEqual(['timestamp-unit'])
    expect(rules([{ kind: 'status', status: { ref: { id: 'o', chatId: 'u1' }, status: 'sent', timestamp: 1_760_000_000 } }])).toEqual(['timestamp-unit'])
  })

  it('flags a respondBy that is not epoch ms after the interaction', () => {
    expect(rules([click({ respondBy: 3 })])).toEqual(['respond-by'])
  })

  it('flags malformed message fields', () => {
    expect(rules([msg({ body: undefined as unknown as string })])).toEqual(['body'])
    expect(rules([msg({ mentions: 'u2' as unknown as string[] })])).toEqual(['mentions'])
    expect(rules([msg({ type: 'gif' as unknown as InboundMessage['type'] })])).toEqual(['message-type'])
  })

  it('assertInboundContract throws an error listing every violation', () => {
    expect(() => assertInboundContract([msg({ timestamp: 1 })], { now: NOW })).toThrow(InboundContractError)
    expect(() => assertInboundContract([msg()], { now: NOW })).not.toThrow()
  })

  it('MockProvider emits epoch ms', () => {
    const provider = new MockProvider()
    const rec = recordEvents(provider)
    provider.incoming('hola')
    provider.interaction('ok')
    assertInboundContract(rec.events)
  })
})

describe('ctx.timestamp is epoch ms', () => {
  it('from the MockProvider', async () => {
    const { bot, chat } = await createTestBot()
    let ts: number | undefined
    bot.when('hola', (ctx) => { ts = ctx.timestamp })
    const before = Date.now()
    await chat.send('hola')
    await vi.waitFor(() => expect(ts).toBeDefined())
    expect(ts!).toBeGreaterThanOrEqual(before - 1000)
    expect(ts!).toBeLessThanOrEqual(Date.now())
    await bot.stop()
  })

  it('converts a legacy provider that still emits epoch seconds', async () => {
    const provider = new MockProvider()
    const bot = new Bot({ provider })
    let ts: number | undefined
    bot.when('hola', (ctx) => { ts = ctx.timestamp })
    await bot.start()
    provider['emitEvent']({ kind: 'message', message: msg({ timestamp: 1_760_000_000, body: 'hola' }) })
    await vi.waitFor(() => expect(ts).toBe(1_760_000_000_000))
    await bot.stop()
  })
})

describe('receiveTimestamp (message log order)', () => {
  it('uses the receive time for a second-precision stamp of the current second, in seconds or ms', async () => {
    const { receiveTimestamp } = await import('../src/core/ledger.js')
    const now = 1_760_000_000_640
    expect(receiveTimestamp(1_760_000_000, now)).toBe(now)
    expect(receiveTimestamp(1_760_000_000_000, now)).toBe(now)
    // A precise ms stamp, or an old one, is kept.
    expect(receiveTimestamp(1_760_000_000_321, now)).toBe(1_760_000_000_321)
    expect(receiveTimestamp(1_759_999_990_000, now)).toBe(1_759_999_990_000)
  })
})

describe('checkCapabilityContract', () => {
  it('MockProvider conforms in every streaming mode', async () => {
    const { assertCapabilityContract } = await import('../src/testing/index.js')
    for (const streaming of ['none', 'edit', 'draft'] as const) assertCapabilityContract(new MockProvider({ streaming }))
  })

  it('flags a no-op method standing in for an unsupported operation, and bad limits', async () => {
    const { checkCapabilityContract, CapabilityContractError, assertCapabilityContract } = await import('../src/testing/index.js')
    const base = new MockProvider().capabilities
    const fake = {
      id: 'fake',
      capabilities: { ...base, typing: false, readReceipts: true, buttons: true, contentKinds: ['text' as const], maxTextLength: 0, streaming: 'draft' as const },
      async typing() {},
    }
    expect([...new Set(checkCapabilityContract(fake).map((v) => v.rule))].sort()).toEqual(['content-kinds', 'drafts', 'read-receipts', 'text-limit', 'typing'])
    expect(() => assertCapabilityContract(fake)).toThrow(CapabilityContractError)
  })
})

describe('RateLimitedError.retryAfterMs', () => {
  it('is capped at 24 h so no wait built on it overflows setTimeout', async () => {
    const { RateLimitedError } = await import('../src/index.js')
    expect(new RateLimitedError(1e15).retryAfterMs).toBe(86_400_000)
    expect(new RateLimitedError(Infinity).retryAfterMs).toBe(86_400_000)
    expect(new RateLimitedError(1500).retryAfterMs).toBe(1500)
  })
})
