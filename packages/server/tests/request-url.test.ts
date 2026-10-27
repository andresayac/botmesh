import { afterEach, describe, expect, it } from 'vitest'
import { createFetchHandler, createIngress, createNodeHandler } from '../src/index.js'
import { listen, type Running } from './support.js'

let running: Running | undefined
afterEach(async () => { await running?.close(); running = undefined })

function recorder() {
  const seen: unknown[] = []
  const provider = { ingest: (_raw: unknown, _headers: unknown, url?: string) => { seen.push(url); return 200 } }
  return { seen, provider }
}

// Queries that URLSearchParams would re-encode: signature schemes (Twilio)
// sign the exact URL, so the raw request-target must reach `ingest`.
const RAW_QUERIES = ['tenant=a%20b', 'flag', 'next=/x', 't=~x', 'a=1&&b=%7E', 'x=a+b&y=%2B']

describe('ingress: request URL for query-token webhooks', () => {
  it('passes the request path and query string as the third ingest argument', async () => {
    const { seen, provider } = recorder()
    running = await listen(createNodeHandler(createIngress({ routes: [{ path: '/wpp', provider }] })))
    const res = await fetch(`${running.url}/wpp?token=abc&x=1`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(seen).toEqual(['/wpp?token=abc&x=1'])
  })

  it.each(RAW_QUERIES)('node handler passes the raw query unchanged (%s)', async (query) => {
    const { seen, provider } = recorder()
    running = await listen(createNodeHandler(createIngress({ routes: [{ path: '/twilio', provider }] })))
    const res = await fetch(`${running.url}/twilio?${query}`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(seen).toEqual([`/twilio?${query}`])
  })

  it.each(RAW_QUERIES)('fetch handler passes the raw query unchanged (%s)', async (query) => {
    const { seen, provider } = recorder()
    const handler = createFetchHandler(createIngress({ routes: [{ path: '/twilio', provider }] }))
    const res = await handler(new Request(`http://example.test/twilio?${query}`, { method: 'POST', body: '{}' }))
    expect(res.status).toBe(200)
    expect(seen).toEqual([`/twilio?${query}`])
  })

  it('omits the "?" when the query is empty or bare', async () => {
    const { seen, provider } = recorder()
    running = await listen(createNodeHandler(createIngress({ routes: [{ path: '/twilio', provider }] })))
    await fetch(`${running.url}/twilio`, { method: 'POST', body: '{}' })
    await fetch(`${running.url}/twilio?`, { method: 'POST', body: '{}' })
    expect(seen).toEqual(['/twilio', '/twilio'])
  })

  it('falls back to the parsed query for custom adapters without rawQuery', async () => {
    const { seen, provider } = recorder()
    const ingress = createIngress({ routes: [{ path: '/twilio', provider }] })
    await ingress.handle({
      method: 'POST', path: '/twilio', query: new URLSearchParams('tenant=a'), headers: {},
      readBody: async () => Buffer.from('{}'),
    })
    expect(seen).toEqual(['/twilio?tenant=a'])
  })
})
