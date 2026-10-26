/**
 * Defects found by the beta release review (new user + attacker pass): REST path
 * injection through ids, unsolicited @everyone / role pings, attachment alt text
 * over Discord's limit, empty-text events for sticker/embed-only messages, a second
 * start() leaking the first gateway, frames from a superseded socket, and an
 * unchecked retry_after on code 40003.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboundMessage } from '@botmesh/core'
import { ProviderError, RateLimitedError } from '@botmesh/core'
import { DiscordProvider } from '../src/DiscordProvider.js'
import { GatewaySocket } from '../src/gateway.js'
import { parseDispatch } from '../src/parseInbound.js'
import { toDiscordError } from '../src/restClient.js'
import type { SocketLike } from '../src/types.js'
import { fakeSocketFactory } from './_fakeSocket.js'

interface Call { url: string; method: string; body: unknown }

function mockFetch(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown = init?.body
    if (typeof body === 'string') body = JSON.parse(body)
    else if (body instanceof FormData) body = JSON.parse(String(body.get('payload_json')))
    calls.push({ url, method: init?.method ?? 'GET', body })
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'OUT' }) }
  }))
  return calls
}

const live: DiscordProvider[] = []
function provider(over: Record<string, unknown> = {}): DiscordProvider {
  const { factory } = fakeSocketFactory()
  const p = new DiscordProvider({ token: 'TOK', socketFactory: factory, reconnectDelayMs: 0, ...over } as never)
  live.push(p)
  return p
}

afterEach(async () => {
  while (live.length) await live.pop()!.stop()
  vi.unstubAllGlobals()
})

describe('REST path segments cannot be injected through ids', () => {
  it.each([
    ['a slash', '../guilds/G1/members/U1#'],
    ['a query', 'C1?x=1'],
    ['a dot segment', '..'],
  ])('a channel id with %s is encoded or rejected, never reaching another route', async (_label, chatId) => {
    const calls = mockFetch()
    const p = provider()
    await p.send(chatId, { kind: 'text', text: 'hi' }).catch((err: unknown) => {
      expect(err).toBeInstanceOf(ProviderError)
      expect(String((err as Error).message)).toMatch(/invalid Discord/i)
    })
    for (const c of calls) {
      const path = new URL(c.url).pathname
      expect(path.startsWith('/api/v10/channels/')).toBe(true)
      expect(path.split('/').length).toBe(6) // '', api, v10, channels, {id}, messages
    }
  })

  it('a message id cannot climb out of the message route on delete/edit', async () => {
    const calls = mockFetch()
    const p = provider()
    await p.deleteMessage({ chatId: 'C1', id: '../../../guilds/G1' }).catch(() => undefined)
    await p.editMessage({ chatId: 'C1', id: 'M1/../../x' }, { kind: 'text', text: 'x' }).catch(() => undefined)
    for (const c of calls) expect(new URL(c.url).pathname).toMatch(/^\/api\/v10\/channels\/C1\/messages\/[^/]+$/)
  })

  it('an interaction token with path characters stays inside its segment', async () => {
    const calls = mockFetch()
    const { sockets, factory } = fakeSocketFactory()
    const p = new DiscordProvider({ token: 'TOK', socketFactory: factory, autoAcknowledgeMs: false })
    live.push(p)
    await p.start()
    sockets[0]!.serverSend({ op: 0, t: 'INTERACTION_CREATE', s: 1, d: {
      id: '123', type: 3, token: 'abc/../../../channels/C1/messages', channel_id: 'C1',
      user: { id: 'U1' }, data: { custom_id: 'b', component_type: 2 },
    } })
    await p.acknowledgeInteraction('123')
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]!.url).pathname).toMatch(/^\/api\/v10\/interactions\/123\/[^/]+\/callback$/)
  })
})

describe('mentions are safe by default', () => {
  it('a plain send cannot ping @everyone, @here or roles from its text', async () => {
    const calls = mockFetch()
    const p = provider()
    await p.send('C1', { kind: 'text', text: '@everyone <@&42> look' })
    expect((calls[0]!.body as Record<string, unknown>)['allowed_mentions']).toEqual({ parse: ['users'] })
  })

  it('allowedMentions configures the default; explicit mentions and platformData still win', async () => {
    const calls = mockFetch()
    const p = provider({ allowedMentions: { parse: ['users', 'roles', 'everyone'] } })
    await p.send('C1', { kind: 'text', text: 'a' })
    await p.send('C1', { kind: 'text', text: 'b' }, { mentions: ['U1'] })
    await p.send('C1', { kind: 'text', text: 'c' }, { platformData: { allowed_mentions: { parse: [] } } })
    expect(calls.map((c) => (c.body as Record<string, unknown>)['allowed_mentions'])).toEqual([
      { parse: ['users', 'roles', 'everyone'] },
      { users: ['U1'] },
      { parse: [] },
    ])
  })

  it('a native payload keeps exactly what the caller wrote', async () => {
    const calls = mockFetch()
    const p = provider()
    await p.send('C1', { kind: 'native', provider: 'discord', payload: { content: '@everyone' } })
    expect(calls[0]!.body).toEqual({ content: '@everyone' })
  })

  it('rejects an invalid allowedMentions value at construction', () => {
    expect(() => provider({ allowedMentions: 'none' })).toThrow(/allowedMentions/)
  })
})

describe('attachment alt text', () => {
  it('a caption over 1024 characters is still sent (alt text is cut to Discord\'s limit)', async () => {
    const calls = mockFetch()
    const p = provider()
    const caption = 'x'.repeat(1500)
    await p.send('C1', { kind: 'image', media: Buffer.from('img'), caption })
    const body = calls[0]!.body as { content: string; attachments: Array<{ description: string }> }
    expect(body.content).toBe(caption)
    expect(Array.from(body.attachments[0]!.description).length).toBeLessThanOrEqual(1024)
  })
})

describe('messages with nothing readable', () => {
  const base = { id: '1300000000000000001', channel_id: 'C1', author: { id: 'U1', username: 'ana' }, type: 0 }

  it('a sticker-only message is a sticker, not an empty text', () => {
    const e = parseDispatch('MESSAGE_CREATE', { ...base, content: '', sticker_items: [{ id: '749054660769218631', name: 'Wave', format_type: 1 }] })
    const m = (e as { message: InboundMessage }).message
    expect(m.type).toBe('sticker')
    expect(m.body).toBe('')
  })

  it('an embed-only (or content-intent-less) message is unknown, never an empty text', () => {
    const e = parseDispatch('MESSAGE_CREATE', { ...base, content: '', embeds: [{ title: 't' }] })
    expect((e as { message: InboundMessage }).message.type).toBe('unknown')
  })

  it('interactions in a guild carry the guild id like messages do', () => {
    const e = parseDispatch('INTERACTION_CREATE', {
      id: '1300000000000000002', type: 3, token: 'T', channel_id: 'C1', guild_id: 'G1',
      member: { user: { id: 'U1' } }, data: { custom_id: 'b', component_type: 2 },
    })
    expect((e as { interaction: { chat: { platformData?: unknown } } }).interaction.chat.platformData).toEqual({ guildId: 'G1' })
  })
})

describe('lifecycle', () => {
  it('a second start() without stop() does not leave the first gateway running', async () => {
    const { sockets, factory } = fakeSocketFactory()
    const p = new DiscordProvider({ token: 'TOK', socketFactory: factory, reconnectDelayMs: 0 })
    live.push(p)
    await p.start()
    await p.start()
    const open = sockets.filter((s) => s.closedWith.length === 0)
    expect(open.length).toBe(1)
  })

  it('frames from a superseded socket (no removeAllListeners) are ignored', async () => {
    const handlers: Array<Record<string, Array<(...a: unknown[]) => void>>> = []
    const sockets: SocketLike[] = []
    const factory = (): SocketLike => {
      const h: Record<string, Array<(...a: unknown[]) => void>> = {}
      handlers.push(h)
      const s: SocketLike = { send: () => undefined, close: () => undefined, on: (e, l) => { (h[e] ??= []).push(l) } }
      sockets.push(s)
      return s
    }
    const seen: string[] = []
    const gw = new GatewaySocket({
      token: 'T', intents: 0, gatewayUrl: 'wss://x', socketFactory: factory, reconnectDelayMs: 0,
      logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
      dispatch: (t) => seen.push(t), connection: () => undefined,
    })
    await gw.connect()
    const emit = (i: number, frame: unknown) => { for (const l of handlers[i]!['message'] ?? []) l(JSON.stringify(frame)) }
    emit(0, { op: 7 }) // server-requested reconnect: socket 0 is superseded
    await new Promise((r) => setTimeout(r, 5))
    expect(sockets.length).toBe(2)
    emit(0, { op: 0, t: 'MESSAGE_CREATE', s: 99, d: {} })
    expect(seen).toEqual([])
    await gw.stop()
  })
})

describe('error mapping', () => {
  it('code 40003 with a bogus retry_after still yields a positive, bounded delay', () => {
    for (const retry_after of [-5, 1e12]) {
      const err = toDiscordError('C1', 400, { code: 40_003, message: 'slow down', retry_after })
      expect(err).toBeInstanceOf(RateLimitedError)
      const ms = (err as RateLimitedError).retryAfterMs ?? 0
      expect(ms).toBeGreaterThan(0)
      expect(ms).toBeLessThanOrEqual(86_400_000)
    }
  })
})

describe('config from optional env vars', () => {
  it('an explicit undefined keeps every default (intents, URLs, API version, backoff)', async () => {
    const calls = mockFetch()
    const { sockets, urls, factory } = fakeSocketFactory()
    const p = new DiscordProvider({
      token: 'TOK', socketFactory: factory, appId: undefined, selfId: undefined,
      intents: undefined, gatewayUrl: undefined, apiUrl: undefined, apiVersion: undefined, reconnectDelayMs: undefined,
    })
    live.push(p)
    await p.start()
    sockets[0]!.serverSend({ op: 10, d: { heartbeat_interval: 60_000 } })
    expect(urls[0]).toBe('wss://gateway.discord.gg/?v=10&encoding=json')
    expect((sockets[0]!.sent.find((f) => f['op'] === 2)!['d'] as { intents: unknown }).intents).toBe((1 << 0) | (1 << 9) | (1 << 15))
    await p.send('C1', { kind: 'text', text: 'x' })
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/C1/messages')
  })
})

describe('config mistakes fail fast with an actionable message', () => {
  it('a token pasted with the "Bot " prefix is rejected', () => {
    expect(() => new DiscordProvider({ token: 'Bot abc.def' })).toThrow(/without the "Bot " prefix/)
  })

  it('a token read with a trailing newline is trimmed before use', async () => {
    const calls: Array<Record<string, string>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.headers as Record<string, string>)
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'OUT' }) }
    }))
    const p = provider({ token: 'abc.def\n' })
    await p.send('C1', { kind: 'text', text: 'x' })
    expect(calls[0]!['Authorization']).toBe('Bot abc.def')
  })

  it.each([
    ['reconnectDelayMs', -1],
    ['reconnectDelayMs', Number.NaN],
    ['intents', -1],
    ['intents', 1.5],
  ])('%s = %s throws', (field, value) => {
    expect(() => new DiscordProvider({ token: 'T', [field]: value })).toThrow(new RegExp(field))
  })
})

describe('GatewayIntents', () => {
  it('lists every documented v10 intent bit', async () => {
    const { GatewayIntents } = await import('../src/index.js')
    expect(GatewayIntents).toMatchObject({
      GuildScheduledEvents: 1 << 16,
      AutoModerationConfiguration: 1 << 20,
      AutoModerationExecution: 1 << 21,
      GuildMessagePolls: 1 << 24,
      DirectMessagePolls: 1 << 25,
    })
  })
})

describe('seeded gateway fuzzing', () => {
  it('random frames (any op, event, payload shape) never throw out of the socket listener nor emit malformed events', async () => {
    let seed = 0xdecaf
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
    /** Mostly a well-formed value (the first ones), sometimes garbage. */
    const vp = (good: unknown[], bad: unknown[]): unknown => (rnd() < 0.8 ? pick(good) : pick(bad))
    const values: unknown[] = [null, true, false, 0, -1, 1e308, '', 'x', '..', '../guilds', '🎉', [], {}, [1, 'a'], { id: '1' }]
    const events = ['READY', 'RESUMED', 'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'INTERACTION_CREATE', 'GUILD_CREATE', '', 'x']
    const message = () => ({
      id: vp(['1', '2'], values), channel_id: vp(['C1'], values), author: vp([{ id: 'U1' }, { id: 'U1', bot: true }], values),
      content: vp(['hi', ''], values), type: vp([0, 19, undefined, 7], values), edited_timestamp: vp(['2026-01-01T00:00:00Z', null], values),
      attachments: vp([[], [{ url: 'https://cdn.discordapp.com/a.png', content_type: 'image/png', filename: 'a.png', id: '1' }]], values),
      sticker_items: vp([undefined, [{ id: '1', format_type: 1 }]], values), message_reference: vp([undefined, { type: 1 }, { message_id: '5' }], values),
      message_snapshots: vp([undefined, [{ message: { content: 'f' } }]], values), poll: vp([undefined, { question: { text: 'q' } }], values),
      token: vp(['T'], values), data: vp([{ custom_id: 'b', component_type: 2 }, { component_type: 3, values: ['a'] }], values),
      member: vp([{ user: { id: 'U2' } }], values), user: vp([{ id: 'U3' }], values),
    })
    const { sockets, factory } = fakeSocketFactory()
    const logger = { debug() {}, info() {}, warn() {}, error() {} }
    const p = new DiscordProvider({ token: 'T', socketFactory: factory, reconnectDelayMs: 0, autoAcknowledgeMs: false, logger })
    live.push(p)
    const emitted: unknown[] = []
    p.onEvent((e) => { emitted.push(e) })
    await p.start()
    for (let i = 0; i < 1500; i++) {
      const s = sockets.at(-1)!
      const op = pick([0, 0, 0, 0, 1, 7, 9, 10, 11, 42, ...values])
      const frame = op === 10 ? { op, d: { heartbeat_interval: pick([60_000, ...values]) } }
        : { op, t: pick(events), s: pick([i, ...values]), d: pick([message(), message(), message(), ...values]) }
      expect(() => s.emit('message', rnd() < 0.05 ? '{bad json' : JSON.stringify(frame))).not.toThrow()
      // op 7 / 9 drop the socket: let the reconnect timer open the next one.
      if (op === 7 || op === 9 || i % 500 === 0) await new Promise((r) => setTimeout(r, 1))
    }
    for (const e of emitted as Array<{ kind: string; message?: InboundMessage; interaction?: { chatId: unknown; senderId: unknown; interactionId: unknown } }>) {
      if (e.kind === 'message') {
        expect(typeof e.message!.chatId).toBe('string')
        expect(typeof e.message!.senderId).toBe('string')
        expect(typeof e.message!.body).toBe('string')
        expect(e.message!.type === 'text' && e.message!.body === '').toBe(false)
      }
      if (e.kind === 'interaction') {
        expect(typeof e.interaction!.chatId).toBe('string')
        expect(typeof e.interaction!.interactionId).toBe('string')
      }
    }
    expect(emitted.some((e) => (e as { kind: string }).kind === 'message')).toBe(true)
  }, 20_000)
})
