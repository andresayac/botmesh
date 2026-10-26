import { afterEach, describe, expect, it } from 'vitest'
import { createIngress, createNodeHandler } from '../src/index.js'
import { listen, type Running } from './support.js'

let running: Running | undefined
afterEach(async () => { await running?.close(); running = undefined })

describe('ingress: request URL for query-token webhooks', () => {
  it('passes the request path and query string as the third ingest argument', async () => {
    const seen: unknown[] = []
    const provider = { ingest: (_raw: unknown, _headers: unknown, url?: string) => { seen.push(url); return 200 } }
    running = await listen(createNodeHandler(createIngress({ routes: [{ path: '/wpp', provider }] })))
    const res = await fetch(`${running.url}/wpp?token=abc&x=1`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(seen).toEqual(['/wpp?token=abc&x=1'])
  })
})
