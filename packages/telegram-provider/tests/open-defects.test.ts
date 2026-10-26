/** Low-severity defects left open by the alpha exit review (docs/release-readiness.md). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitedError } from '@botmesh/core'
import { TelegramProvider, toTelegramError } from '../src/TelegramProvider.js'
import { parseUpdate } from '../src/parseInbound.js'

const silent = { debug() {}, info() {}, warn() {}, error() {} }
const json = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } })
const me = { id: 9, is_bot: true, first_name: 'Bot', username: 'MyBot' }
const update = (id: number, text = 'hola') => ({ update_id: id, message: { message_id: id, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5, first_name: 'Ana' }, text } })

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('webhook mode lifecycle', () => {
  it('ingest() after stop() emits nothing and answers 503 (Telegram redelivers later)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(me)))
    const p = new TelegramProvider({ token: 'T', polling: false, allowUnsignedWebhooks: true, logger: silent })
    const seen: string[] = []
    p.onEvent((e) => { if (e.kind === 'message') seen.push(e.message.body) })
    await p.start()
    expect(p.ingest(update(1, 'antes'))).toBe(200)
    await p.stop()
    expect(p.ingest(update(2, 'despues'))).toBe(503)
    expect(seen).toEqual(['antes'])
    await p.start()
    expect(p.ingest(update(3, 'otra vez'))).toBe(200)
    expect(seen).toEqual(['antes', 'otra vez'])
    await p.stop()
  })

  it('a start() that races stop() never emits ready after closed', async () => {
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = () => resolve(json(me)) })))
    const p = new TelegramProvider({ token: 'T', polling: false, allowUnsignedWebhooks: true, logger: silent })
    const states: string[] = []
    p.onEvent((e) => { if (e.kind === 'connection') states.push(e.update.state) })
    const starting = p.start()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await p.stop()
    release()
    await starting.catch(() => undefined)
    expect(states.at(-1)).toBe('closed')
    expect(states).not.toContain('ready')
  })
})

describe('draft stop callbacks stay bounded', () => {
  it('keeps at most 1000 pending onStop callbacks, dropping the oldest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(true)))
    const p = new TelegramProvider({ token: 'T', polling: false, allowUnsignedWebhooks: true, logger: silent })
    for (let i = 0; i < 1500; i++) await p.sendDraft('77', i + 1, 'x', { canStop: true, onStop: () => {} })
    const map = (p as unknown as { draftStops: Map<string, unknown> }).draftStops
    expect(map.size).toBeLessThanOrEqual(1000)
    expect(map.has('77:1500')).toBe(true)
    expect(map.has('77:1')).toBe(false)
  })
})

describe('commands in media captions', () => {
  it('drops this bot\'s @mention from a caption command (/menu@MyBot)', () => {
    const ev = parseUpdate({
      update_id: 1,
      message: {
        message_id: 1, date: 1, chat: { id: -100, type: 'supergroup', title: 'G' }, from: { id: 5, first_name: 'Ana' },
        photo: [{ file_id: 'F', file_unique_id: 'U', width: 1, height: 1 }],
        caption: '/menu@MyBot hoy', caption_entities: [{ type: 'bot_command', offset: 0, length: 11 }],
      },
    } as never, '9', 'MyBot')
    expect(ev?.kind).toBe('message')
    if (ev?.kind === 'message') expect(ev.message.body).toBe('/menu hoy')
  })

  it('leaves a caption command addressed to another bot untouched', () => {
    const ev = parseUpdate({
      update_id: 2,
      message: {
        message_id: 2, date: 1, chat: { id: -100, type: 'supergroup', title: 'G' }, from: { id: 5, first_name: 'Ana' },
        document: { file_id: 'D', file_unique_id: 'U' },
        caption: '/menu@OtherBot', caption_entities: [{ type: 'bot_command', offset: 0, length: 14 }],
      },
    } as never, '9', 'MyBot')
    if (ev?.kind === 'message') expect(ev.message.body).toBe('/menu@OtherBot')
  })
})

describe('429 retry_after is clamped', () => {
  it('caps a huge retry_after at 24 h and ignores a negative or non-finite one', () => {
    expect((toTelegramError('1', 429, 'Too Many Requests', 10 ** 12) as RateLimitedError).retryAfterMs).toBe(24 * 60 * 60 * 1000)
    expect((toTelegramError('1', 429, 'x', -5) as RateLimitedError).retryAfterMs).toBe(1000)
    expect((toTelegramError('1', 429, 'x', Number.NaN) as RateLimitedError).retryAfterMs).toBe(1000)
    expect((toTelegramError('1', 429, 'x', 3) as RateLimitedError).retryAfterMs).toBe(3000)
  })
})

describe('uploads have their own timeout', () => {
  it('a multipart upload may take longer than requestTimeoutMs, up to uploadTimeoutMs', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      if (init?.body instanceof FormData) {
        const t = setTimeout(() => resolve(json({ message_id: 1, date: 1, chat: { id: 5, type: 'private' } })), 120)
        init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal!.reason) }, { once: true })
        return
      }
      resolve(json(true))
    })))
    const p = new TelegramProvider({ token: 'T', polling: false, allowUnsignedWebhooks: true, requestTimeoutMs: 50, uploadTimeoutMs: 2_000, logger: silent })
    await expect(p.send('5', { kind: 'image', media: Buffer.from('png') })).resolves.toBeTruthy()
    expect(() => new TelegramProvider({ token: 'T', uploadTimeoutMs: 0 })).toThrow(/uploadTimeoutMs/)
  })
})
