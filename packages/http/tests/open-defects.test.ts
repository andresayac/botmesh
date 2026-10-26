import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { fetchBuffer, isPrivateAddress, secureFetch } from '../src/index.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()) })))
})
function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)))
}

describe('isPrivateAddress: IPv4-translated IPv6 (RFC 2765, ::ffff:0:0:0/96)', () => {
  it('judges the embedded IPv4', () => {
    expect(isPrivateAddress('::ffff:0:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:0:a00:1')).toBe(true) // 10.0.0.1
    expect(isPrivateAddress('0:0:0:0:ffff:0:c0a8:101')).toBe(true) // 192.168.1.1
    expect(isPrivateAddress('::ffff:0:5db8:d822')).toBe(false) // 93.184.216.34
  })
})

describe('a timeout while reading the body of an error response', () => {
  it('reports TIMEOUT, not the HTTP status (real server, headers sent, body stalls)', async () => {
    const port = await listen((_req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.write('partial') })
    const err = await fetchBuffer(`http://127.0.0.1:${port}/`, { allowHttp: true, allowPrivateHosts: true, timeoutMs: 150 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'TIMEOUT' })
  })

  it('reports TIMEOUT when a custom fetch ignores the signal and its body never ends', async () => {
    const fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')) } }), { status: 502 })
    const err = await secureFetch('https://cdn.example/x', { fetch, resolver: async () => ['93.184.216.34'], timeoutMs: 100 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('timeoutMs bounds the whole request, not only the body', () => {
  it('rejects with TIMEOUT when a custom fetch ignores the signal and never answers', async () => {
    const started = Date.now()
    const err = await secureFetch('https://cdn.example/x', { fetch: () => new Promise<Response>(() => {}), resolver: async () => ['93.184.216.34'], timeoutMs: 100 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('rejects with TIMEOUT when DNS resolution never settles', async () => {
    const started = Date.now()
    const err = await secureFetch('https://cdn.example/x', { fetch: async () => new Response('ok'), resolver: () => new Promise<string[]>(() => {}), timeoutMs: 100 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it("rejects with the caller's abort reason while DNS or the fetch hangs", async () => {
    const ctrl = new AbortController()
    const reason = new Error('caller gave up')
    const pending = secureFetch('https://cdn.example/x', { fetch: () => new Promise<Response>(() => {}), resolver: async () => ['93.184.216.34'], signal: ctrl.signal, timeoutMs: 10_000 }).catch((e: unknown) => e)
    setTimeout(() => ctrl.abort(reason), 20)
    expect(await pending).toBe(reason)
  })
})

