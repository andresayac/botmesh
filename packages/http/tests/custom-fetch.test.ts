/**
 * A caller-supplied `fetch` (Node's global fetch, an instrumented fetch, a test
 * double) must work: the pinned undici dispatcher belongs to this package's
 * undici and is rejected by any other fetch implementation (UND_ERR_INVALID_ARG).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { isPrivateAddress, secureFetch } from '../src/index.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()) })))
})

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as { port: number }).port)
  }))
}

describe('@botmesh/http — custom fetch', () => {
  it('works with Node\'s built-in fetch', async () => {
    const port = await listen((_req, res) => res.end('global-ok'))
    const { body, response } = await secureFetch(`http://127.0.0.1:${port}/`, {
      allowHttp: true,
      allowPrivateHosts: true,
      fetch: globalThis.fetch,
    })
    expect(response.status).toBe(200)
    expect(body.toString()).toBe('global-ok')
  })

  it('does not hand a foreign fetch the internal pinned dispatcher', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok'))
    await secureFetch('https://cdn.example/x', { fetch, resolver: async () => ['93.184.216.34'] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![1]).not.toHaveProperty('dispatcher')
  })

  it('still validates the destination before calling a custom fetch', async () => {
    const fetch = vi.fn(async () => new Response('never'))
    await expect(secureFetch('https://internal.example/', { fetch, resolver: async () => ['10.0.0.5'] }))
      .rejects.toMatchObject({ code: 'UNSAFE_HOST' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('@botmesh/http — fully-qualified hostnames', () => {
  it.each(['localhost.', 'LOCALHOST.', 'foo.localhost.', '127.0.0.1.'])('treats %s as private', (host) => {
    expect(isPrivateAddress(host)).toBe(true)
  })
})
