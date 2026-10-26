/**
 * Seeded fuzz of the Node ingress over real sockets: random methods, paths, bodies, lying
 * Content-Length headers and misbehaving providers. The ingress must always answer (or
 * reset an over-long body), never log the body, and end with no request in flight.
 */
import { describe, expect, it } from 'vitest'
import { createIngress, createNodeHandler } from '../src/index.js'
import { listen, rawRequest, recordingLogger } from './support.js'

function prng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! }
}

describe('ingress fuzz', () => {
  it('answers every request and never leaks bodies into logs', async () => {
    const r = prng(42)
    const SECRET = 'body-secret-marker'
    const behaviours = [
      () => 200,
      () => ({ status: 202, body: { ok: true }, headers: { 'x-ok': '1', 'bad\nheader': 'x', 'x-inject': 'a\r\nset-cookie: y' } }),
      () => { throw new SyntaxError(`Unexpected token in ${SECRET}`) },
      () => { throw new Error(`boom ${SECRET}`) },
      () => Promise.reject(new Error(`async ${SECRET}`)),
      () => new Promise((resolve) => setTimeout(() => resolve(204), 5)),
      () => ({ status: 99999 }),
      () => 'not a status',
      () => null,
    ]
    const provider = {
      verifyChallenge: (q: Record<string, string>) => (q['hub.verify_token'] === 'ok' ? q['hub.challenge'] ?? '' : null),
      ingest: () => r.pick(behaviours)(),
    }
    const { logger, entries } = recordingLogger()
    const ingress = createIngress({ routes: [{ path: '/webhook', provider }, { path: '/tg', provider: { ingest: () => 200 }, body: 'text', maxBodyBytes: 64 }], logger, maxBodyBytes: 1024, bodyTimeoutMs: 200 })
    const running = await listen(createNodeHandler(ingress, { drain: { timeoutMs: 200 } }))
    try {
      for (let i = 0; i < 250; i++) {
        const path = r.pick(['/webhook', '/webhook/', '/tg', '/healthz', '/readyz', '/nope', '/webhook?hub.verify_token=ok&hub.challenge=123', '/webhook?x=%E0%A4%A', '/WEBHOOK', '//webhook'])
        const method = r.pick(['POST', 'POST', 'POST', 'GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])
        const size = r.pick([0, 1, 10, 63, 65, 500, 1024, 1025, 5000])
        const body = Buffer.from(`${SECRET}${'x'.repeat(size)}`.slice(0, size))
        // One connection per request: a lying Content-Length must not poison a pooled socket.
        const headers: Record<string, string> = { connection: 'close' }
        if (r.next() < 0.3) headers['content-length'] = String(r.pick([size, size + 10, 99999999, 0]))
        const chunks = method === 'GET' || method === 'HEAD' ? [] : r.next() < 0.5 ? [body] : [body.subarray(0, size >> 1), body.subarray(size >> 1)]
        if (headers['content-length'] && Number(headers['content-length']) !== chunks.reduce((n, c) => n + c.length, 0)) {
          // A lying length only makes sense for "too large" declarations; keep the socket protocol valid otherwise.
          if (Number(headers['content-length']) < 99999999) delete headers['content-length']
        }
        const res = await Promise.race([rawRequest(running.port, { method, path, headers, chunks }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`hang #${i}: ${method} ${path} size=${size} headers=${JSON.stringify(headers)} chunks=${chunks.length}`)), 3000))])
        expect([0, 200, 202, 204, 400, 403, 404, 405, 408, 413, 500, 503], `${method} ${path} ${size}`).toContain(res.status)
        expect(res.headers['set-cookie'], 'no header injection').toBeUndefined()
      }
      expect(ingress.inflight).toBe(0)
      expect(JSON.stringify(entries)).not.toContain(SECRET)
    } finally {
      await ingress.close({ timeoutMs: 1000 })
      await running.close()
    }
  }, 60_000)
})
