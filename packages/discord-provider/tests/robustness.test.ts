import { describe, it, expect, vi, afterEach } from 'vitest'
import pino from 'pino'
import { UnsupportedContentError } from '@botmesh/core'
import { DiscordProvider } from '../src/DiscordProvider.js'
import { GatewaySocket } from '../src/gateway.js'
import { parseDispatch } from '../src/parseInbound.js'
import { expectWellFormedEvent, mutations } from '../../../test-utils/fuzz.js'
import { fakeSocketFactory, wait } from './_fakeSocket.js'

const logger = pino({ level: 'silent' })
const msg = (over: Record<string, unknown> = {}) => ({
  id: '1234567890123456789', channel_id: 'C1', guild_id: 'G1', author: { id: 'A1', username: 'ana' }, content: 'hi',
  mentions: [{ id: 'B1' }], attachments: [], ...over,
})

describe('parseDispatch on malformed or non-user frames', () => {
  const samples: Array<[string, unknown]> = [
    ['MESSAGE_CREATE', msg({
      attachments: [{ id: '1', filename: 'a.png', url: 'https://cdn.discordapp.com/a.png', content_type: 'image/png', size: 3 }],
      message_reference: { message_id: '9', channel_id: 'C1' }, referenced_message: { content: 'x', author: { id: 'Z' } },
      member: { nick: 'Ana' }, timestamp: '2026-01-01T00:00:00.000Z',
    })],
    ['INTERACTION_CREATE', { id: '1234567890123456789', token: 'tok', type: 3, channel_id: 'C1', member: { user: { id: 'A1' } }, data: { component_type: 3, custom_id: 'c', values: ['v'] }, message: { id: 'M' } }],
    ['INTERACTION_CREATE', { id: '1234567890123456789', token: 'tok', type: 2, channel: { id: 'C1' }, user: { id: 'A1' }, data: { name: 'ping' } }],
  ]

  it('seeded random mutations never throw and only yield well-formed events', () => {
    let produced = 0
    for (const [t, sample] of samples) {
      for (const d of mutations(20260425, [sample], 2000)) {
        const ev = parseDispatch(t, d, 'SELF')
        if (ev) { produced++; expectWellFormedEvent(ev) }
      }
    }
    expect(produced).toBeGreaterThan(200)
  })

  it('system messages (member join, pins, boosts…) are not user text', () => {
    expect(parseDispatch('MESSAGE_CREATE', msg({ type: 7, content: '' }))).toBeUndefined() // USER_JOIN
    expect(parseDispatch('MESSAGE_CREATE', msg({ type: 6, content: '' }))).toBeUndefined() // CHANNEL_PINNED_MESSAGE
    expect(parseDispatch('MESSAGE_CREATE', msg({ type: 0 }))?.kind).toBe('message')
    expect(parseDispatch('MESSAGE_CREATE', msg({ type: 19 }))?.kind).toBe('message') // REPLY
    expect(parseDispatch('MESSAGE_CREATE', msg())?.kind).toBe('message') // type omitted
  })
})

describe('gateway resilience', () => {
  const live: GatewaySocket[] = []
  afterEach(async () => { while (live.length) await live.pop()!.stop() })

  it('a JSON frame that is not an object is dropped, not thrown into the socket listener', async () => {
    const { sockets, factory } = fakeSocketFactory()
    const gw = new GatewaySocket({ token: 'T', intents: 1, gatewayUrl: 'wss://x', socketFactory: factory, logger, dispatch: vi.fn(), connection: vi.fn(), reconnectDelayMs: 0 })
    live.push(gw)
    await gw.connect()
    expect(() => sockets[0].emit('message', 'null')).not.toThrow()
    expect(() => sockets[0].emit('message', '42')).not.toThrow()
  })

  it('a dispatch handler that throws is logged, never escapes into the socket listener', async () => {
    const { sockets, factory } = fakeSocketFactory()
    const warn = vi.fn()
    const gw = new GatewaySocket({
      token: 'T', intents: 1, gatewayUrl: 'wss://x', socketFactory: factory, logger: { ...logger, warn, error: warn } as never,
      dispatch: () => { throw new Error('boom') }, connection: vi.fn(), reconnectDelayMs: 0,
    })
    live.push(gw)
    await gw.connect()
    expect(() => sockets[0].serverSend({ op: 0, s: 1, t: 'MESSAGE_CREATE', d: {} })).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })

  it('an invalid heartbeat_interval falls back to the documented default instead of a busy loop', async () => {
    vi.useFakeTimers()
    try {
      const { sockets, factory } = fakeSocketFactory()
      const gw = new GatewaySocket({ token: 'T', intents: 1, gatewayUrl: 'wss://x', socketFactory: factory, logger, dispatch: vi.fn(), connection: vi.fn(), reconnectDelayMs: 0 })
      live.push(gw)
      await gw.connect()
      sockets[0].serverSend({ op: 10, d: { heartbeat_interval: 0 } })
      const before = sockets[0].sent.length
      vi.advanceTimersByTime(1000)
      expect(sockets[0].sent.length - before).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconnect backoff keeps growing while sessions fail right after the socket opens', async () => {
    vi.useFakeTimers()
    try {
      const { sockets, factory } = fakeSocketFactory()
      const gw = new GatewaySocket({ token: 'T', intents: 1, gatewayUrl: 'wss://x', socketFactory: factory, logger, dispatch: vi.fn(), connection: vi.fn(), reconnectDelayMs: 100 })
      live.push(gw)
      await gw.connect()
      // Open then immediately rate-limited (4008), three times in a row.
      for (let i = 0; i < 3; i++) {
        const s = sockets[sockets.length - 1]
        s.emit('open')
        s.emit('close', 4008)
        vi.advanceTimersByTime(100 * 2 ** i - 1)
        expect(sockets.length).toBe(i + 1) // not yet reconnected
        vi.advanceTimersByTime(1)
        expect(sockets.length).toBe(i + 2)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Discord outbound contract', () => {
  it('rejects native content addressed to another provider instead of posting it', async () => {
    const provider = new DiscordProvider({ token: 'T', socketFactory: fakeSocketFactory().factory })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const err = await provider.send('C1', { kind: 'native', provider: 'telegram', payload: { text: 'x' } }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
    await wait(0)
  })
})

describe('Discord config errors', () => {
  it('a missing token fails at construction with an actionable message', () => {
    expect(() => new DiscordProvider({ token: undefined as unknown as string })).toThrow(/DiscordProvider requires `token`/)
    expect(() => new DiscordProvider({ token: '  ' })).toThrow(/DiscordProvider requires `token`/)
  })
})
