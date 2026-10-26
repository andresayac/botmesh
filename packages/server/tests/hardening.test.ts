/**
 * Release-test findings: configuration mistakes fail fast with a clear message, every status an
 * `ingest()` may return is served the same way by the node and fetch paths, readiness never
 * rejects `handle()`, and absolute-form request targets are routed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { createFetchHandler, createIngress, createNodeHandler, type IngressOptions } from '../src/index.js'
import { splitUrl } from '../src/internal.js'
import { FakeWebhookProvider, IngestOnlyProvider, listen, type Running } from './support.js'

let running: Running | undefined
afterEach(async () => { await running?.close(); running = undefined })

describe('ingress hardening: configuration errors', () => {
  it('names the problem when options or routes are missing', () => {
    expect(() => createIngress(undefined as unknown as IngressOptions)).toThrow(/@botmesh\/server: createIngress\(\) needs an options object/)
    expect(() => createIngress({} as IngressOptions)).toThrow(/@botmesh\/server: options\.routes must be an array/)
    expect(() => createIngress({ routes: [null as never] })).toThrow(/@botmesh\/server: routes\[0\] must be an object/)
  })

  it('rejects an unknown body mode instead of silently using a Buffer', () => {
    expect(() => createIngress({ routes: [{ path: '/a', provider: new IngestOnlyProvider(), body: 'json' as never }] }))
      .toThrow(/body of "\/a" must be 'buffer' or 'text'/)
  })

  it('rejects timeouts that setTimeout would silently clamp to 1 ms', () => {
    expect(() => createIngress({ routes: [], bodyTimeoutMs: 2 ** 31 })).toThrow(/bodyTimeoutMs must be at most 2147483647/)
    expect(() => createIngress({ routes: [], ingestTimeoutMs: 3e9 })).toThrow(/ingestTimeoutMs/)
    expect(() => createIngress({ routes: [], ingestTimeoutMs: 2 ** 31 - 1 })).not.toThrow()
  })

  it('rejects the same path for /healthz and /readyz', () => {
    expect(() => createIngress({ routes: [], healthPath: '/health', readyPath: '/health/' })).toThrow(/duplicate path "\/health"/)
  })

  it('rejects a bot without getConnectionState() and a non-function readiness', () => {
    expect(() => createIngress({ routes: [], bot: {} as never })).toThrow(/bot must have a getConnectionState\(\) method/)
    expect(() => createIngress({ routes: [], readiness: true as never })).toThrow(/readiness must be a function/)
  })

  it('rejects an invalid close() timeout', async () => {
    const ingress = createIngress({ routes: [] })
    await expect(ingress.close({ timeoutMs: -1 })).rejects.toThrow(/close\(\) timeoutMs/)
    await expect(ingress.close({ timeoutMs: 2 ** 31 })).rejects.toThrow(/close\(\) timeoutMs/)
  })
})

describe('ingress hardening: readiness never rejects handle()', () => {
  it('answers 503 when bot.getConnectionState() throws', async () => {
    const ingress = createIngress({ routes: [], bot: { getConnectionState: () => { throw new Error('boom') } } })
    const res = await ingress.handle({ method: 'GET', path: '/readyz', query: new URLSearchParams(), headers: {}, readBody: async () => Buffer.alloc(0) })
    expect(res?.status).toBe(503)
    expect(JSON.parse(res!.body)).toEqual({ status: 'not_ready' })
    expect(await ingress.isReady()).toBe(false)
  })
})

describe('ingress hardening: statuses returned by ingest()', () => {
  const statuses = [100, 101, 199, 204, 205, 304, 600, 1.5]
  for (const status of statuses) {
    it(`node and fetch agree on ingest() â†’ ${status}`, async () => {
      const provider = new FakeWebhookProvider()
      provider.result = status
      const ingress = createIngress({ routes: [{ path: '/webhook', provider }] })
      running = await listen(createNodeHandler(ingress))
      const viaNode = await fetch(`${running.url}/webhook`, { method: 'POST', body: '{}' })
      const viaFetch = await createFetchHandler(ingress)(new Request('http://x/webhook', { method: 'POST', body: '{}' }))
      const expected = status >= 200 && status <= 599 && Number.isInteger(status) ? status : 200
      expect(viaNode.status).toBe(expected)
      expect(viaFetch.status).toBe(expected)
    })
  }

  it('serves a 205 { status, body } result without a body on the fetch path', async () => {
    const provider = new FakeWebhookProvider()
    provider.result = { status: 205, body: 'ignored' }
    const res = await createFetchHandler(createIngress({ routes: [{ path: '/webhook', provider }] }))(new Request('http://x/webhook', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(205)
    expect(await res.text()).toBe('')
  })
})

describe('ingress hardening: request targets', () => {
  it('splitUrl reduces an absolute-form target to its path', () => {
    expect(splitUrl('http://example.com/webhook?token=a')).toEqual({ path: '/webhook', query: new URLSearchParams('token=a') })
    expect(splitUrl('https://example.com')).toEqual({ path: '/', query: new URLSearchParams() })
    expect(splitUrl('*').path).toBe('*')
  })

  it('routes an absolute-form request (RFC 9112 Â§3.2.2)', async () => {
    const provider = new FakeWebhookProvider()
    running = await listen(createNodeHandler(createIngress({ routes: [{ path: '/webhook', provider }] })))
    const status = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(running!.port, '127.0.0.1', () => {
        socket.write(`POST http://127.0.0.1:${running!.port}/webhook HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`)
      })
      let data = ''
      socket.on('data', (c) => { data += c.toString() })
      socket.on('end', () => resolve(data.split('\r\n')[0]!))
      socket.on('error', reject)
    })
    expect(status).toBe('HTTP/1.1 200 OK')
    expect(provider.calls).toHaveLength(1)
  })
})

describe('ingress hardening: seeded fuzz of the fetch path', () => {
  it('always resolves a Response, whatever ingest() returns', async () => {
    let seed = 7
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
    const results: Array<() => unknown> = [
      () => Math.floor(rand() * 700),
      () => ({ status: Math.floor(rand() * 700), body: pick(['', 'x', { a: 1 }, null]) }),
      () => ({ status: pick([204, 205, 304]), body: 'nope', headers: { 'x-a': '1', 'bad\r\n': 'x' } }),
      () => Promise.resolve(pick([101, 205, 304, 418])),
      () => { throw new SyntaxError('x') },
      () => undefined,
    ]
    const provider = { ingest: () => pick(results)(), verifyChallenge: (q: Record<string, string>) => q['c'] ?? null }
    const ingress = createIngress({ routes: [{ path: '/w', provider }], maxBodyBytes: 256 })
    const handler = createFetchHandler(ingress)
    for (let i = 0; i < 400; i++) {
      const method = pick(['POST', 'POST', 'GET', 'HEAD', 'PUT', 'OPTIONS'])
      const path = pick(['/w', '/w/', '/w?c=1', '/healthz', '/readyz', '/x', '/w?c=%F0%9F%8E%89'])
      const body = method === 'GET' || method === 'HEAD' ? undefined : 'Ã©ðŸŽ‰'.repeat(Math.floor(rand() * 100))
      const res = await handler(new Request(`http://h${path}`, { method, body }))
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThanOrEqual(599)
      await res.arrayBuffer()
    }
    expect(ingress.inflight).toBe(0)
  })
})

describe('ingress hardening: connection loss', () => {
  it('frees the slot and its timer when the client disappears mid-body', async () => {
    const provider = new FakeWebhookProvider()
    const ingress = createIngress({ routes: [{ path: '/webhook', provider }], bodyTimeoutMs: 60_000 })
    running = await listen(createNodeHandler(ingress))
    const timersBefore = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve) => {
        const socket = createConnection(running!.port, '127.0.0.1', () => {
          socket.write('POST /webhook HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{"partial":')
          setTimeout(() => { socket.destroy(); resolve() }, 10)
        })
      })
    }
    for (let i = 0; i < 100 && ingress.inflight > 0; i++) await new Promise((r) => setTimeout(r, 10))
    expect(ingress.inflight).toBe(0)
    expect(provider.calls).toHaveLength(0)
    const timersAfter = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    expect(timersAfter).toBeLessThanOrEqual(timersBefore)
  })
})

describe('ingress hardening: headers returned by ingest()', () => {
  const routes = (headers: Record<string, string>) => [{ path: '/w', provider: { ingest: () => ({ status: 200, body: { ok: 1 }, headers }) } }]

  it('replaces the ingress headers case-insensitively instead of duplicating them', async () => {
    const ingress = createIngress({ routes: routes({ 'Content-Type': 'application/vnd.x+json', 'X-Trace': 'abc' }) })
    const res = await ingress.handle({ method: 'POST', path: '/w', query: new URLSearchParams(), headers: {}, readBody: async () => Buffer.alloc(0) })
    expect(res?.headers).toEqual({ 'content-type': 'application/vnd.x+json', 'cache-control': 'no-store', 'x-trace': 'abc' })

    const fetchRes = await createFetchHandler(ingress)(new Request('http://h/w', { method: 'POST', body: '{}' }))
    expect(fetchRes.headers.get('content-type')).toBe('application/vnd.x+json')
  })

  it('drops framing and hop-by-hop headers so the response stays parseable', async () => {
    const ingress = createIngress({ routes: routes({
      'Content-Length': '1', 'Transfer-Encoding': 'chunked', Connection: 'upgrade', 'Keep-Alive': 'timeout=5', Upgrade: 'h2c',
      'Proxy-Connection': 'x', TE: 'trailers', Trailer: 'x-a', 'X-Ok': '1',
    }) })
    const res = await ingress.handle({ method: 'POST', path: '/w', query: new URLSearchParams(), headers: {}, readBody: async () => Buffer.alloc(0) })
    expect(Object.keys(res?.headers ?? {}).sort()).toEqual(['cache-control', 'content-type', 'x-ok'])

    running = await listen(createNodeHandler(ingress))
    const viaNode = await fetch(`${running.url}/w`, { method: 'POST', body: '{}' })
    expect(viaNode.status).toBe(200)
    expect(await viaNode.json()).toEqual({ ok: 1 })
    expect(viaNode.headers.get('content-length')).toBe('8')
    expect(viaNode.headers.get('x-ok')).toBe('1')
  })
})
