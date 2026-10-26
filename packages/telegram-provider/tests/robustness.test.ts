/**
 * Release-readiness hardening: stop latency, readiness, request timeouts,
 * secret redaction, webhook body/header shapes and config validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProviderError, UnsupportedContentError } from '@botmesh/core'
import { TelegramProvider } from '../src/TelegramProvider.js'

interface Call { url: string; init?: RequestInit }

/** Fake fetch; a responder returning `'hang'` never answers until the request is aborted. */
function mockFetch(responder: (call: Call) => { status?: number; body?: unknown } | 'hang') {
  const calls: Call[] = []
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    const r = responder(call)
    if (r === 'hang') {
      return new Promise((_, reject) => {
        const signal = init?.signal
        if (signal?.aborted) return reject(signal.reason)
        signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true })
      })
    }
    return Promise.resolve({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      headers: { get: () => null },
      json: async () => r.body ?? {},
    })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

const waitFor = async (cond: () => boolean, ms = 1500): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const TOKEN = '123456:SECRET-token_value'

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('long-poll lifecycle', () => {
  it('stop() does not wait for the error backoff to elapse', async () => {
    mockFetch((call) => {
      if (call.url.includes('/getUpdates')) return { status: 500, body: { ok: false, error_code: 500, description: 'boom' } }
      return { body: { ok: true, result: {} } }
    })
    const p = new TelegramProvider({ token: TOKEN, selfId: '9', errorBackoffMs: 30_000 })
    await p.start()
    await new Promise((r) => setTimeout(r, 30)) // first round failed, now sleeping 30 s
    const t0 = Date.now()
    await p.stop()
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('stop() does not wait for a 429 retry_after to elapse', async () => {
    mockFetch((call) => {
      if (call.url.includes('/getUpdates')) return { status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 60 } } }
      return { body: { ok: true, result: {} } }
    })
    const p = new TelegramProvider({ token: TOKEN, selfId: '9' })
    await p.start()
    await new Promise((r) => setTimeout(r, 30))
    const t0 = Date.now()
    await p.stop()
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('leaves no timers behind after stop()', async () => {
    mockFetch((call) => {
      if (call.url.includes('/getUpdates')) return { status: 500, body: { ok: false, error_code: 500, description: 'boom' } }
      return { body: { ok: true, result: {} } }
    })
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const p = new TelegramProvider({ token: TOKEN, selfId: '9', errorBackoffMs: 30_000 })
    await p.start()
    await new Promise((r) => setTimeout(r, 30))
    await p.stop()
    await new Promise((r) => setImmediate(r))
    const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    expect(after).toBeLessThanOrEqual(before)
  })

  it('announces ready without waiting a full long-poll timeout (first round uses timeout 0)', async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('/getUpdates')) {
        const body = JSON.parse(call.init!.body as string) as { timeout: number }
        // A real server holds a long poll open for `timeout` seconds when idle.
        return body.timeout > 0 ? 'hang' : { body: { ok: true, result: [] } }
      }
      return { body: { ok: true, result: {} } }
    })
    const p = new TelegramProvider({ token: TOKEN, selfId: '9', pollTimeout: 30, pollIdleMs: 1 })
    const states: string[] = []
    p.onEvent((e) => { if (e.kind === 'connection') states.push(e.update.state) })
    await p.start()
    await waitFor(() => states.includes('ready'), 1000)
    const polls = calls.filter((c) => c.url.includes('/getUpdates')).map((c) => JSON.parse(c.init!.body as string).timeout)
    expect(polls[0]).toBe(0)
    await waitFor(() => calls.filter((c) => c.url.includes('/getUpdates')).length >= 2)
    expect(JSON.parse(calls.filter((c) => c.url.includes('/getUpdates'))[1].init!.body as string).timeout).toBe(30)
    await p.stop() // aborts the hanging long poll
  })

  it('a long poll that never answers is abandoned and retried (no silent dead loop)', async () => {
    let n = 0
    const calls = mockFetch((call) => {
      if (call.url.includes('/getUpdates')) return n++ === 0 ? 'hang' : { body: { ok: true, result: [] } }
      return { body: { ok: true, result: {} } }
    })
    // pollTimeout 0 → the client gives the server requestTimeoutMs of grace.
    const p = new TelegramProvider({ token: TOKEN, selfId: '9', pollTimeout: 0, requestTimeoutMs: 50, errorBackoffMs: 1, pollIdleMs: 1 })
    const states: string[] = []
    p.onEvent((e) => { if (e.kind === 'connection') states.push(e.update.state) })
    await p.start()
    await waitFor(() => states.includes('ready'), 1500)
    expect(calls.filter((c) => c.url.includes('/getUpdates')).length).toBeGreaterThanOrEqual(2)
    await p.stop()
  })

  it('null / non-object entries in a getUpdates batch are skipped without wedging the loop', async () => {
    const msg = (id: number, text: string) => ({
      update_id: id,
      message: { message_id: id, date: 1, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'a' }, text },
    })
    const offsets: unknown[] = []
    mockFetch((call) => {
      if (call.url.includes('/getUpdates')) {
        const body = JSON.parse(call.init!.body as string) as { offset?: number }
        offsets.push(body.offset)
        if (body.offset == null) return { body: { ok: true, result: [msg(1, 'hi'), null, undefined, 'junk', 42, msg(3, 'after')] } }
        return { body: { ok: true, result: [] } }
      }
      return { body: { ok: true, result: {} } }
    })
    const p = new TelegramProvider({ token: TOKEN, selfId: '9', errorBackoffMs: 1, pollIdleMs: 1 })
    const states: string[] = []
    const bodies: string[] = []
    p.onEvent((e) => {
      if (e.kind === 'connection') states.push(e.update.state)
      if (e.kind === 'message') bodies.push(e.message.body)
    })
    await p.start()
    await waitFor(() => states.includes('ready') && offsets.length >= 2, 1000)
    await p.stop()
    expect(bodies).toEqual(['hi', 'after'])
    expect(offsets[1]).toBe(4) // advanced past the whole batch, never re-polled from scratch
  })
})

describe('outbound requests', () => {
  it('a send that never answers rejects with a ProviderError after requestTimeoutMs', async () => {
    mockFetch(() => 'hang')
    const p = new TelegramProvider({ token: TOKEN, requestTimeoutMs: 50 })
    const err = await p.send('1', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/timed out/i)
    expect((err as Error).message).toContain('sendMessage')
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('a network failure rejects with a ProviderError whose message and cause never carry the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`fetch failed for ${url}`) }))
    const p = new TelegramProvider({ token: TOKEN })
    const err = await p.send('1', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).not.toContain(TOKEN)
    expect(JSON.stringify(String((err as { cause?: unknown }).cause))).not.toContain(TOKEN)
    expect((err as Error).message).toContain('sendMessage')
  })

  it('a failing getUpdates never logs the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`Failed to parse URL from ${url}`) }))
    const lines: string[] = []
    const logger = { debug: (...a: unknown[]) => lines.push(JSON.stringify(a)), info: (...a: unknown[]) => lines.push(JSON.stringify(a)), warn: (...a: unknown[]) => lines.push(JSON.stringify(a)), error: (...a: unknown[]) => lines.push(JSON.stringify(a)) }
    const p = new TelegramProvider({ token: TOKEN, selfId: '9', errorBackoffMs: 1, maxBackoffMs: 2, logger })
    await p.start()
    await waitFor(() => lines.length >= 2)
    await p.stop()
    expect(lines.join('\n')).not.toContain(TOKEN)
    expect(lines.join('\n')).not.toContain('SECRET')
  })

  it('a start() failure (getMe) never carries the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`Failed to parse URL from ${url}`) }))
    const p = new TelegramProvider({ token: TOKEN })
    const err = await p.start().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('a media string that is neither a URL nor a readable file explains how to reuse a file_id', async () => {
    mockFetch(() => ({ body: { ok: true, result: { message_id: 1, chat: { id: 1 } } } }))
    const p = new TelegramProvider({ token: TOKEN })
    const err = await p.send('1', { kind: 'video', media: 'BAACAgIAAxkBAAIB' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as UnsupportedContentError).message).toMatch(/native/)
    expect((err as UnsupportedContentError).kind ?? (err as { contentKind?: string }).contentKind).toBe('video')
  })
})

describe('media download failures', () => {
  it('a refused / reset file download never puts the token in the error (message or cause)', async () => {
    const { createServer } = await import('node:http')
    // getFile answers over the stubbed fetch; the file GET goes to a closed loopback port.
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>((r) => probe.close(() => r()))
    mockFetch(() => ({ body: { ok: true, result: { file_id: 'f', file_path: 'photos/x.jpg' } } }))
    const p = new TelegramProvider({
      token: TOKEN,
      baseUrl: `http://127.0.0.1:${port}`,
      mediaDownload: { allowHttp: true, allowPrivateHosts: true, timeoutMs: 2000 },
    })
    const err = await p.downloadMedia({ kind: 'image', token: 'f' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    const seen = [String((err as Error).message), String((err as { cause?: { message?: string } }).cause?.message ?? ''), JSON.stringify(err)]
    for (const s of seen) expect(s).not.toContain('SECRET')
  })
})

describe('webhook ingest', () => {
  const update = { update_id: 7, message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'hi' } }

  it('accepts the raw body as a Buffer or Uint8Array (what @botmesh/server hands by default)', () => {
    const p = new TelegramProvider({ token: TOKEN, polling: false, webhookSecret: 's3cret', selfId: '9' })
    const seen: string[] = []
    p.onEvent((e) => { if (e.kind === 'message') seen.push(e.message.body) })
    const headers = { 'x-telegram-bot-api-secret-token': 's3cret' }
    expect(p.ingest(Buffer.from(JSON.stringify(update)), headers)).toBe(200)
    expect(p.ingest(new TextEncoder().encode(JSON.stringify({ ...update, update_id: 8 })), headers)).toBe(200)
    expect(seen).toEqual(['hi', 'hi'])
  })

  it('matches the secret header case-insensitively and from a Fetch Headers object', () => {
    const p = new TelegramProvider({ token: TOKEN, polling: false, webhookSecret: 's3cret', selfId: '9' })
    expect(p.ingest(update, { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' })).toBe(200)
    expect(p.ingest(update, new Headers({ 'X-Telegram-Bot-Api-Secret-Token': 's3cret' }))).toBe(200)
    expect(p.ingest(update, new Headers({ 'X-Telegram-Bot-Api-Secret-Token': 'nope' }))).toBe(401)
    expect(p.ingest(update, { 'X-TELEGRAM-BOT-API-SECRET-TOKEN': 'wrong' })).toBe(401)
  })

  it('a payload that makes the normalizer throw is answered 200 and logged, never thrown at the host', () => {
    const errors: unknown[] = []
    const logger = { debug() {}, info() {}, warn() {}, error: (...a: unknown[]) => errors.push(a) }
    const p = new TelegramProvider({ token: TOKEN, polling: false, allowUnsignedWebhooks: true, selfId: '9', logger })
    const evil = { update_id: 9, message: { message_id: 1, chat: { id: 1, type: 'private' }, photo: [null] } }
    expect(() => p.ingest(evil)).not.toThrow()
    expect(p.ingest(evil)).toBe(200)
  })
})

describe('config validation', () => {
  it('rejects a missing or blank token with an actionable message', () => {
    expect(() => new TelegramProvider({ token: undefined as unknown as string })).toThrow(/token.*BotFather/i)
    expect(() => new TelegramProvider({ token: '  ' })).toThrow(/token/i)
  })

  it('rejects a baseUrl that is not an http(s) URL, without echoing the token', () => {
    let msg = ''
    try { new TelegramProvider({ token: TOKEN, baseUrl: 'api.telegram.org' }) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/baseUrl/)
    expect(msg).not.toContain(TOKEN)
  })

  it('rejects non-positive / non-finite numeric options', () => {
    expect(() => new TelegramProvider({ token: TOKEN, pollTimeout: -1 })).toThrow(/pollTimeout/)
    expect(() => new TelegramProvider({ token: TOKEN, requestTimeoutMs: 0 })).toThrow(/requestTimeoutMs/)
    expect(() => new TelegramProvider({ token: TOKEN, errorBackoffMs: Number.NaN })).toThrow(/errorBackoffMs/)
  })
})
