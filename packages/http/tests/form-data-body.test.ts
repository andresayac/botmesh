import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { secureFetch } from '../src/index.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

async function echoServer(): Promise<{ url: string; seen: Array<{ headers: IncomingHttpHeaders; body: Buffer }> }> {
  const seen: Array<{ headers: IncomingHttpHeaders; body: Buffer }> = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks) })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload`, seen }
}

describe('secureFetch: FormData bodies', () => {
  it('sends a global FormData as multipart/form-data (not "[object FormData]")', async () => {
    const { url, seen } = await echoServer()
    const form = new FormData()
    form.append('business_id', 'b1')
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'photo.jpg')
    await secureFetch(url, { method: 'POST', body: form, allowHttp: true, allowPrivateHosts: true })
    expect(seen).toHaveLength(1)
    expect(String(seen[0]!.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/)
    const parsed = await new Response(new Uint8Array(seen[0]!.body), { headers: { 'content-type': String(seen[0]!.headers['content-type']) } }).formData()
    expect(parsed.get('business_id')).toBe('b1')
    const file = parsed.get('file') as File
    expect(file.name).toBe('photo.jpg')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
  })

  it('keeps a caller Content-Type only when it is not multipart (the boundary must match the body)', async () => {
    const { url, seen } = await echoServer()
    const form = new FormData()
    form.append('a', '1')
    await secureFetch(url, { method: 'POST', body: form, headers: { 'Content-Type': 'multipart/form-data' }, allowHttp: true, allowPrivateHosts: true })
    expect(String(seen[0]!.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/)
  })
})
