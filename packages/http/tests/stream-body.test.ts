import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { secureFetch } from '../src/index.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

async function echoServer(): Promise<{ url: string; seen: Buffer[] }> {
  const seen: Buffer[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => { seen.push(Buffer.concat(chunks)); res.end(`got ${Buffer.concat(chunks).length}`) })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload`, seen }
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() } })
}

describe('secureFetch: streaming bodies', () => {
  it('uploads a ReadableStream body through the closed SecureFetchOptions (duplex is set for it)', async () => {
    const { url, seen } = await echoServer()
    const result = await secureFetch(url, { method: 'POST', body: streamOf('hello'), allowHttp: true, allowPrivateHosts: true })
    expect(result.body.toString()).toBe('got 5')
    expect(seen[0]!.toString()).toBe('hello')
  })

  it('passes duplex: "half" to a custom fetch only for a stream body', async () => {
    const seen: Array<RequestInit & { duplex?: string }> = []
    const fetch = (async (_url: string, init: RequestInit) => { seen.push(init); return new Response('ok') }) as typeof globalThis.fetch
    const resolver = async () => ['93.184.216.34']
    await secureFetch('https://example.com/a', { method: 'POST', body: streamOf('x'), fetch, resolver })
    await secureFetch('https://example.com/b', { method: 'POST', body: 'plain', fetch, resolver })
    expect(seen[0]!.duplex).toBe('half')
    expect(seen[1]!.duplex).toBeUndefined()
  })

  it('still accepts an explicit duplex through the deprecated overload', async () => {
    const { url } = await echoServer()
    const body = Readable.toWeb(Readable.from([Buffer.from('abc')])) as ReadableStream<Uint8Array>
    const result = await secureFetch(url, { method: 'POST', body, duplex: 'half', allowHttp: true, allowPrivateHosts: true } as Parameters<typeof secureFetch>[1] & { duplex: 'half' })
    expect(result.body.toString()).toBe('got 3')
  })
})
