import { request } from 'node:http'
import { connect } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pino from 'pino'
import { SANDBOX_TOKEN_HEADER, startSandbox, toUserInput, SandboxInputError, type RunningSandbox } from '../src/index.js'

const logger = pino({ level: 'silent' })

interface RawResponse { status: number; headers: Record<string, string | string[] | undefined>; text: string; json(): unknown }

/** A request with full control over Host/Origin (fetch would set them itself). Event streams resolve on headers. */
function raw(base: string, method: string, path: string, opts: { headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<RawResponse> {
  const url = new URL(base)
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, method, path, headers: { host: url.host, ...(opts.body !== undefined ? { 'content-length': String(Buffer.byteLength(opts.body)) } : {}), ...(opts.headers ?? {}) } }, (res) => {
      const chunks: Buffer[] = []
      const done = () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) as unknown })
      }
      if (String(res.headers['content-type'] ?? '').startsWith('text/event-stream')) {
        res.destroy()
        done()
        return
      }
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', done)
      res.on('error', reject)
    })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

let sandbox: RunningSandbox
let token: string
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  raw(sandbox.url, 'POST', path, { headers: { 'content-type': 'application/json', [SANDBOX_TOKEN_HEADER]: token, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeAll(async () => {
  sandbox = await startSandbox({ port: 0, logger, channels: ['telegram', 'discord'], bot: 'none', autoStatus: false })
  token = sandbox.token
})
afterAll(() => sandbox.stop())

describe('hub: Host / Origin checks (DNS rebinding, cross-site requests)', () => {
  it('binds to 127.0.0.1 by default', () => {
    expect(new URL(sandbox.url).hostname).toBe('127.0.0.1')
  })

  it('accepts loopback Host headers on the right port', async () => {
    const port = new URL(sandbox.url).port
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      expect((await raw(sandbox.url, 'GET', '/api/channels', { headers: { host } })).status, host).toBe(200)
    }
  })

  it('rejects a foreign Host (DNS rebinding) on every route, including the UI', async () => {
    const port = new URL(sandbox.url).port
    for (const path of ['/', '/api/channels', '/api/telegram/timeline', '/api/events']) {
      const res = await raw(sandbox.url, 'GET', path, { headers: { host: `attacker.example:${port}` } })
      expect(res.status, path).toBe(403)
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Host') })
    }
    expect((await raw(sandbox.url, 'GET', '/api/channels', { headers: { host: '127.0.0.1:1' } })).status).toBe(403)
    // No Host at all (HTTP/1.0 allows it) is refused too.
    const port2 = Number(new URL(sandbox.url).port)
    const answer = await new Promise<string>((resolve, reject) => {
      const sock = connect(port2, '127.0.0.1', () => sock.end('GET /api/channels HTTP/1.0\r\n\r\n'))
      let out = ''
      sock.on('data', (c) => { out += c.toString() })
      sock.on('end', () => resolve(out))
      sock.on('error', reject)
    })
    expect(answer.split(' ')[1]).toBe('403')
  })

  it('rejects a cross-origin request even with the token', async () => {
    for (const origin of ['http://attacker.example', 'null', `http://127.0.0.1:1`]) {
      const res = await post('/api/telegram/reset', {}, { origin })
      expect(res.status, origin).toBe(403)
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Origin') })
    }
    expect((await post('/api/telegram/reset', {}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })

  it('accepts the same origin', async () => {
    expect((await post('/api/telegram/reset', {}, { origin: sandbox.url, 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('keeps every simulator on 127.0.0.1 whatever host the hub binds to', async () => {
    // The simulators have no Host check and no token (the provider APIs they imitate expect
    // none), so only the hub follows --host / host; the in-process bots dial 127.0.0.1.
    const other = await startSandbox({ port: 0, logger, channels: ['telegram', 'discord'], bot: 'none', autoStatus: false, host: '::1' })
    try {
      expect(new URL(other.url).hostname).toBe('[::1]')
      for (const sim of Object.values(other.sims)) expect(new URL(sim!.url).hostname, sim!.channel).toBe('127.0.0.1')
    } finally {
      await other.stop()
    }
  })

  it('honours allowedHosts for a sandbox exposed on purpose', async () => {
    const other = await startSandbox({ port: 0, logger, channels: ['telegram'], bot: 'none', autoStatus: false, allowedHosts: ['sandbox.test'] })
    try {
      const port = new URL(other.url).port
      expect((await raw(other.url, 'GET', '/api/channels', { headers: { host: `sandbox.test:${port}` } })).status).toBe(200)
      expect((await raw(other.url, 'GET', '/api/channels', { headers: { host: `evil.test:${port}` } })).status).toBe(403)
    } finally {
      await other.stop()
    }
  })
})

describe('hub: per-run token for state-changing endpoints', () => {
  it('generates a random token per run and embeds it in the served UI', async () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const other = await startSandbox({ port: 0, logger, channels: ['telegram'], bot: 'none', autoStatus: false })
    try { expect(other.token).not.toBe(token) } finally { await other.stop() }
    const page = await raw(sandbox.url, 'GET', '/')
    expect(page.status).toBe(200)
    expect(page.text).toContain(`<meta name="sandbox-token" content="${token}">`)
    expect(page.headers['x-frame-options']).toBe('DENY')
    expect(String(page.headers['content-security-policy'])).toContain("frame-ancestors 'none'")
  })

  it('accepts a fixed token from the options', async () => {
    const other = await startSandbox({ port: 0, logger, channels: ['telegram'], bot: 'none', autoStatus: false, token: 'a-fixed-token-for-scripts-0123456789' })
    try { expect(other.token).toBe('a-fixed-token-for-scripts-0123456789') } finally { await other.stop() }
  })

  it.each(['send', 'fault', 'status', 'reset'])('POST %s needs the token', async (action) => {
    const missing = await raw(sandbox.url, 'POST', `/api/telegram/${action}`, { headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(missing.status).toBe(401)
    expect(missing.json()).toMatchObject({ error: expect.stringContaining(SANDBOX_TOKEN_HEADER) })
    const wrong = await post(`/api/telegram/${action}`, {}, { [SANDBOX_TOKEN_HEADER]: 'nope' })
    expect(wrong.status).toBe(401)
  })

  it('read-only endpoints work without the token', async () => {
    expect((await raw(sandbox.url, 'GET', '/api/channels')).status).toBe(200)
    expect((await raw(sandbox.url, 'GET', '/api/telegram/timeline')).status).toBe(200)
  })
})

describe('hub: input validation (4xx with a JSON error, never 500)', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'whatsapp'])('unknown channel %s is a 404', async (channel) => {
    const res = await raw(sandbox.url, 'GET', `/api/${channel}/timeline`)
    expect(res.status).toBe(404)
    expect(res.json()).toEqual({ error: `unknown channel ${channel}` })
    expect((await post(`/api/${channel}/send`, { text: 'hola' })).status).toBe(404)
  })

  it('malformed JSON is a 400', async () => {
    const res = await post('/api/telegram/send', '{"text":')
    expect(res.status).toBe(400)
    expect(res.json()).toMatchObject({ error: expect.stringContaining('JSON') })
  })

  it.each([['an array', '[]'], ['a string', '"hola"'], ['null', 'null'], ['a number', '1']])('a body that is %s is a 400', async (_name, body) => {
    expect((await post('/api/telegram/send', body)).status).toBe(400)
  })

  it('a non-JSON content type is a 415', async () => {
    const res = await post('/api/telegram/send', 'text=hola', { 'content-type': 'application/x-www-form-urlencoded' })
    expect(res.status).toBe(415)
  })

  it('an unsupported method is a 405', async () => {
    expect((await raw(sandbox.url, 'DELETE', '/api/telegram/send')).status).toBe(405)
    expect((await raw(sandbox.url, 'PUT', '/api/channels')).status).toBe(405)
  })

  it('bodies over the limit are a 413', async () => {
    const big = JSON.stringify({ kind: 'rateLimit', pad: 'x'.repeat(128 * 1024) })
    expect((await post('/api/telegram/fault', big)).status).toBe(413)
    const announced = await raw(sandbox.url, 'POST', '/api/telegram/send', { headers: { 'content-type': 'application/json', [SANDBOX_TOKEN_HEADER]: token, 'content-length': String(64 * 1024 * 1024) }, body: '' }).catch(() => ({ status: 413 }))
    expect(announced.status).toBe(413)
  })

  it.each([
    [{}, 'one of'],
    [{ text: 1 }, 'text'],
    [{ text: 'a', location: { latitude: 1, longitude: 2 } }, 'only one'],
    [{ media: { kind: 'image' } }, 'media.base64'],
    [{ media: { kind: 'hologram', base64: 'AAAA' } }, 'media.kind'],
    [{ media: { kind: 'image', base64: '***' } }, 'media.base64'],
    [{ location: { latitude: 'north', longitude: 2 } }, 'location.latitude'],
    [{ location: { latitude: 91, longitude: 2 } }, 'location.latitude'],
    [{ reply: { kind: 'carousel', id: 'x' } }, 'reply.kind'],
    [{ reply: { kind: 'button' } }, 'reply.id'],
    [{ pollVote: { pollId: 'p', optionIds: [-1] } }, 'pollVote.optionIds'],
    [{ pollVote: { pollId: '', optionIds: [0] } }, 'pollVote.pollId'],
    [{ text: 'a', user: 'me' }, 'user'],
    [{ text: 'a', user: { id: '' } }, 'user.id'],
    [{ text: 'a', quotedId: 3 }, 'quotedId'],
    [{ text: 'a', surprise: true }, 'surprise'],
  ])('send %j is a 400 that names the problem', async (body, word) => {
    const res = await post('/api/telegram/send', body)
    expect(res.status).toBe(400)
    expect((res.json() as { error: string }).error).toContain(word)
  })

  it('a simulator that cannot express the input answers 422', async () => {
    const res = await post('/api/discord/send', { location: { latitude: 1, longitude: 2 } })
    expect(res.status).toBe(422)
    expect((res.json() as { error: string }).error).toContain('Discord simulator')
  })

  it.each([
    [{ kind: 'meteor' }, 'kind'],
    [{ kind: 'rateLimit', times: 0 }, 'times'],
    [{ kind: 'rateLimit', times: 'many' }, 'times'],
    [{ kind: 'rateLimit', retryAfterSec: -1 }, 'retryAfterSec'],
  ])('fault %j is a 400', async (body, word) => {
    const res = await post('/api/telegram/fault', body)
    expect(res.status).toBe(400)
    expect((res.json() as { error: string }).error).toContain(word)
  })

  it.each([
    [{ status: 'read' }, 'messageId'],
    [{ messageId: 'x', status: 'seen' }, 'status'],
  ])('status %j is a 400', async (body, word) => {
    const res = await post('/api/telegram/status', body)
    expect(res.status).toBe(400)
    expect((res.json() as { error: string }).error).toContain(word)
  })

  it('valid fault / status / reset calls still work', async () => {
    expect((await post('/api/telegram/fault', { kind: 'rateLimit', times: 2, retryAfterSec: 1 })).status).toBe(200)
    expect((await post('/api/telegram/status', { messageId: '1', status: 'read' })).status).toBe(200)
    expect((await post('/api/telegram/reset', {})).status).toBe(200)
  })

  it('serves stored media as inert downloads (no script execution on the UI origin)', async () => {
    const html = Buffer.from('<script>alert(1)</script>').toString('base64')
    expect((await post('/api/telegram/send', { media: { kind: 'document', base64: html, mimetype: 'text/html', filename: 'x.html' } })).status).toBe(200)
    const item = sandbox.sims.telegram!.media.list('user').at(-1)!
    const res = await raw(sandbox.url, 'GET', `/api/telegram/media/${item.id}`)
    expect(res.status).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(String(res.headers['content-security-policy'])).toContain('sandbox')
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment/)
    expect((await raw(sandbox.url, 'GET', '/api/telegram/media/%E0%A4%A')).status).toBe(404)
  })

  it('toUserInput throws a SandboxInputError for bad input', () => {
    expect(() => toUserInput({ text: 5 } as never)).toThrow(SandboxInputError)
    expect(toUserInput({ text: 'hola', user: { id: 'u1', name: 'Ana' } })).toEqual({ text: 'hola', user: { id: 'u1', name: 'Ana' } })
  })
})

describe('hub: poll votes', () => {
  it('reports how the UI should send poll votes for each channel', async () => {
    const channels = (await raw(sandbox.url, 'GET', '/api/channels')).json() as Array<{ channel: string; pollVotes: string }>
    for (const c of channels) expect(['native', 'text']).toContain(c.pollVotes)
    const mode = Object.fromEntries(channels.map((c) => [c.channel, c.pollVotes]))
    if ('telegram' in mode) expect(mode['telegram']).toBe('native')
    if ('discord' in mode) expect(mode['discord']).toBe('text')
    if ('whatsapp' in mode) expect(mode['whatsapp']).toBe('text')
  })

  it('delivers a native poll vote to the Telegram and Discord simulators', async () => {
    for (const channel of ['telegram', 'discord'] as const) {
      const res = await post(`/api/${channel}/send`, { pollVote: { pollId: '1234567890123456789', optionIds: [1] } })
      expect(res.status, channel).toBe(200)
      expect(sandbox.sims[channel]!.inbox.at(-1), channel).toMatchObject({ kind: 'poll_vote', text: '1' })
    }
  })
})

/** Deterministic PRNG so a failing fuzz case can be replayed. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('hub: fuzz', () => {
  it('never answers 5xx and always explains 4xx in JSON', async () => {
    const rnd = mulberry32(0xb07)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
    const segments = ['api', 'telegram', 'discord', 'send', 'fault', 'status', 'reset', 'timeline', 'media', 'channels', 'events', 'assets', 'x.svg', '__proto__', 'constructor', '%00', '%E0%A4%A', '..', '.', '%C3%B1', 'a'.repeat(300), '']
    const values: unknown[] = [null, true, 0, -1, 1e308, 'x', '', [], {}, [1, 'a'], { id: 'x' }, { kind: 'image', base64: 'AA==' }, { latitude: 1, longitude: 2 }, 'A'.repeat(1000)]
    const keys = ['text', 'media', 'location', 'reply', 'pollVote', 'quotedId', 'user', 'kind', 'times', 'retryAfterSec', 'messageId', 'status', '__proto__', 'constructor']
    const body = (): string | Buffer => {
      const r = rnd()
      if (r < 0.15) return Buffer.from(Array.from({ length: Math.floor(rnd() * 64) }, () => Math.floor(rnd() * 256)))
      if (r < 0.25) return JSON.stringify(pick(values))
      const obj: Record<string, unknown> = {}
      for (let i = Math.floor(rnd() * 4); i > 0; i--) {
        const v = pick(values)
        obj[pick(keys)] = rnd() < 0.3 && v && typeof v === 'object' ? { [pick(keys)]: pick(values), ...v } : v
      }
      return JSON.stringify(obj)
    }
    for (let i = 0; i < 400; i++) {
      const method = pick(methods)
      const path = '/' + Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(segments)).join('/')
      const headers: Record<string, string> = {}
      if (rnd() < 0.8) headers[SANDBOX_TOKEN_HEADER] = rnd() < 0.9 ? token : 'bad'
      if (rnd() < 0.8) headers['content-type'] = pick(['application/json', 'application/json; charset=utf-8', 'text/plain', 'multipart/form-data'])
      if (rnd() < 0.1) headers['origin'] = pick([sandbox.url, 'http://evil.test', 'null'])
      const payload = method === 'GET' || method === 'HEAD' ? undefined : body()
      const where = `${method} ${path} ${JSON.stringify(headers)} ${payload?.toString().slice(0, 120) ?? ''}`
      const res = await raw(sandbox.url, method, path, { headers, ...(payload !== undefined ? { body: payload } : {}) }).catch((err: unknown) => { throw new Error(`${where}: ${String(err)}`) })
      expect(res.status, where).toBeGreaterThanOrEqual(200)
      expect(res.status, where).toBeLessThan(500)
      if (res.status >= 400 && method !== 'HEAD') {
        let error: unknown
        try { error = (res.json() as { error?: unknown }).error } catch { error = `not JSON (${res.status}): ${res.text.slice(0, 80)}` }
        expect(error, where).toEqual(expect.any(String))
        expect(String(error), where).not.toMatch(/^not JSON/)
      }
    }
  }, 60_000)

  it('fuzzes bodies and headers on the validated POST routes', async () => {
    const rnd = mulberry32(0x5a4d)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const values: unknown[] = [null, true, false, 0, -1, 1.5, 1e308, -1e308, 'x', '', '***', 'AA==', [], {}, [1, 'a'], [-1], ['0'], { id: 'x' }, { id: '' }, { kind: 'image', base64: 'AA==' }, { kind: 'hologram', base64: 'AA==' }, { latitude: 1, longitude: 2 }, { latitude: 91, longitude: 0 }, { pollId: 'p', optionIds: [0] }, { kind: 'button', id: 'b' }, 'A'.repeat(1000)]
    const keys = ['text', 'media', 'location', 'reply', 'pollVote', 'quotedId', 'user', 'kind', 'times', 'retryAfterSec', 'messageId', 'status', 'base64', 'mimetype', 'filename', 'id', 'name', 'latitude', 'longitude', 'optionIds', 'pollId', '__proto__', 'constructor', 'prototype']
    const scalarFor: Record<string, unknown[]> = {
      kind: ['rateLimit', 'auth', 'server', 'network', 'meteor', 'image', 'button', 'list'],
      status: ['delivered', 'read', 'failed', 'seen'],
      text: ['hola', '', 'x'.repeat(5000)],
    }
    const value = (key: string, depth: number): unknown => {
      const r = rnd()
      if (r < 0.3 && scalarFor[key]) return pick(scalarFor[key]!)
      if (r < 0.55 && depth < 2) return object(depth + 1)
      return pick(values)
    }
    const object = (depth = 0): Record<string, unknown> => {
      const obj: Record<string, unknown> = {}
      for (let i = Math.floor(rnd() * 4); i > 0; i--) {
        const key = pick(keys)
        // defineProperty keeps '__proto__' as an own key, the way JSON.parse produces it.
        Object.defineProperty(obj, key, { value: value(key, depth), enumerable: true, configurable: true, writable: true })
      }
      return obj
    }
    const body = (): string | Buffer => {
      const r = rnd()
      if (r < 0.08) return Buffer.from(Array.from({ length: Math.floor(rnd() * 64) }, () => Math.floor(rnd() * 256)))
      if (r < 0.14) return JSON.stringify(pick(values))
      if (r < 0.2) return JSON.stringify(object()).slice(0, -1)
      return JSON.stringify(object())
    }
    const statuses = new Map<number, number>()
    let reachedHandler = 0
    for (let i = 0; i < 600; i++) {
      const channel = pick(['telegram', 'discord'] as const)
      const action = pick(['send', 'fault', 'status', 'reset'] as const)
      const path = `/api/${channel}/${action}`
      const headers: Record<string, string> = { [SANDBOX_TOKEN_HEADER]: token }
      if (rnd() < 0.05) headers[SANDBOX_TOKEN_HEADER] = 'bad'
      headers['content-type'] = rnd() < 0.9 ? pick(['application/json', 'application/json; charset=utf-8', 'Application/JSON']) : pick(['text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded'])
      if (rnd() < 0.1) headers['origin'] = pick([sandbox.url, 'http://evil.test', 'null'])
      if (rnd() < 0.1) headers['sec-fetch-site'] = pick(['same-origin', 'none', 'cross-site'])
      const payload = body()
      const where = `POST ${path} ${JSON.stringify(headers)} ${payload.toString().slice(0, 160)}`
      const res = await raw(sandbox.url, 'POST', path, { headers, body: payload }).catch((err: unknown) => { throw new Error(`${where}: ${String(err)}`) })
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
      expect(res.status, where).toBeGreaterThanOrEqual(200)
      expect(res.status, where).toBeLessThan(500)
      // 400 (validation), 422 (simulator refusal) and 200 come from the input handlers, past routing and the guard.
      if ([200, 400, 422].includes(res.status)) reachedHandler++
      if (res.status >= 400) {
        let error: unknown
        try { error = (res.json() as { error?: unknown }).error } catch { error = `not JSON (${res.status}): ${res.text.slice(0, 80)}` }
        expect(error, where).toEqual(expect.any(String))
        expect(String(error), where).not.toMatch(/^not JSON/)
      }
    }
    // The point of this loop: most requests reach toUserInput / toFault / toStatus / readJson.
    expect(reachedHandler, JSON.stringify([...statuses])).toBeGreaterThan(400)
    expect(statuses.get(200) ?? 0, JSON.stringify([...statuses])).toBeGreaterThan(10)
    expect(statuses.get(400) ?? 0, JSON.stringify([...statuses])).toBeGreaterThan(100)
    for (const ch of ['telegram', 'discord'] as const) sandbox.sims[ch]!.reset()
  }, 120_000)
})
