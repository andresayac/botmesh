/**
 * Input hardening found by the 1.0 readiness pass: configuration mistakes fail at construction
 * with a TypeError that says what to change (never later, on the first request), and malformed
 * media sources reject with the core's typed errors instead of raw `TypeError`s.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { ProviderError, UnsupportedContentError, type MediaSource } from '@botmesh/core'

import { WaIdentityStore, gatewayBaseUrl, parseRetryAfter, resolveHttpPolicy, resolveMedia, restCall } from '../src/index.js'

describe('gatewayBaseUrl rejects URLs that cannot be a prefix', () => {
  it.each([
    ['http://127.0.0.1:8080/?apikey=1', /query string/],
    ['http://127.0.0.1:8080/#x', /fragment/],
  ])('rejects %j', (url, reason) => {
    expect(() => gatewayBaseUrl('EvolutionProvider', url)).toThrow(TypeError)
    expect(() => gatewayBaseUrl('EvolutionProvider', url)).toThrow(reason)
  })

  it('rejects credentials in the URL without echoing them', () => {
    let err: unknown
    try {
      gatewayBaseUrl('EvolutionProvider', 'http://admin:s3cretpw@127.0.0.1:8080')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TypeError)
    expect((err as Error).message).toMatch(/credentials/)
    expect((err as Error).message).not.toContain('s3cretpw')
  })

  it.each([
    ['http://admin:s3cr@tPass@gw:8080', ['s3cr', 'tPass']],
    ['http://admin:a@b@c@d@gw:8080', ['a@b', 'b@c', 'c@d']],
    ['ftp://u:p@ss@host', ['p@ss', 'ss@host']],
    ['admin:pw@x@gw.local', ['pw@x', 'x@gw']],
    ['http://admin:pw@x@gw:8080/path?q=a@b', ['pw@x']],
  ])('masks the whole user info of %j, also when the password has an @', (url, secrets) => {
    let err: unknown
    try {
      gatewayBaseUrl('X', url)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TypeError)
    for (const secret of secrets) expect((err as Error).message).not.toContain(secret)
  })

  it('does not echo credentials of an invalid URL either', () => {
    expect(() => gatewayBaseUrl('X', 'admin:s3cretpw@gw.local')).toThrow(TypeError)
    try {
      gatewayBaseUrl('X', 'admin:s3cretpw@gw.local')
    } catch (e) {
      expect((e as Error).message).not.toContain('s3cretpw')
    }
  })
})

describe('resolveHttpPolicy validates the numbers up front', () => {
  it.each([
    [{ timeoutMs: 0 }, /timeoutMs/],
    [{ timeoutMs: -1 }, /timeoutMs/],
    [{ timeoutMs: Number.NaN }, /timeoutMs/],
    [{ maxBytes: -1 }, /maxBytes/],
    [{ maxBytes: 1.5 }, /maxBytes/],
  ])('rejects %j with a TypeError', (opts, reason) => {
    expect(() => resolveHttpPolicy('http://127.0.0.1:8080', opts)).toThrow(TypeError)
    expect(() => resolveHttpPolicy('http://127.0.0.1:8080', opts)).toThrow(reason)
  })

  it('keeps valid values', () => {
    expect(resolveHttpPolicy('http://127.0.0.1:8080', { timeoutMs: 5, maxBytes: 0 })).toMatchObject({ timeoutMs: 5, maxBytes: 0 })
  })
})

describe('WaIdentityStore validates maxEntries', () => {
  it.each([0, -1, Number.NaN, 1.5, '5'])('rejects %j', (n) => {
    expect(() => new WaIdentityStore(n as number)).toThrow(TypeError)
    expect(() => new WaIdentityStore(n as number)).toThrow(/maxEntries/)
  })

  it('accepts positive integers and Infinity (unbounded)', () => {
    expect(new WaIdentityStore(1).size).toBe(0)
    expect(new WaIdentityStore(Number.POSITIVE_INFINITY).size).toBe(0)
    expect(new WaIdentityStore(undefined).size).toBe(0)
  })
})

describe('parseRetryAfter only accepts RFC 9110 values', () => {
  it.each(['   ', '0x10', '1e300', 'Infinity', '-5', 'soon'])('ignores %j', (v) => {
    expect(parseRetryAfter(v)).toBeUndefined()
  })

  it('parses delay-seconds (trimmed) and HTTP dates', () => {
    expect(parseRetryAfter('5')).toBe(5000)
    expect(parseRetryAfter(' 2 ')).toBe(2000)
    expect(parseRetryAfter('0')).toBe(0)
    const ms = parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())
    expect(ms).toBeGreaterThan(5000)
    expect(ms).toBeLessThanOrEqual(10_000)
  })
})

describe('resolveMedia rejects malformed sources with typed errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wgk-hardening-'))
  const file = join(dir, 'pic.png')
  writeFileSync(file, Buffer.from([1, 2, 3]))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it.each([null, undefined, 5, true])('rejects %j', async (source) => {
    await expect(resolveMedia('image', source as unknown as MediaSource)).rejects.toBeInstanceOf(UnsupportedContentError)
  })

  it('rejects a stream that yields non-byte chunks', async () => {
    const stream = Readable.from([1, 2])
    await expect(resolveMedia('image', { stream })).rejects.toBeInstanceOf(UnsupportedContentError)
  })

  it('treats { url } as a link only: a path or file: URL in it is rejected, never read on either host', async () => {
    for (const url of [pathToFileURL(file).href, file, 'file://127.0.0.1/c$/x', 'ftp://gw.local/etc/passwd', 'pic.png', '']) {
      const err = await resolveMedia('image', { url }).catch((e: unknown) => e)
      expect(err, url).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toMatch(/\{ path \}/)
    }
    await expect(resolveMedia('image', { url: 'https://cdn.example.com/a.png' })).resolves.toEqual({ url: 'https://cdn.example.com/a.png', filename: undefined, mimetype: undefined })
  })

  it('still reads local files given as { path } or a bare string', async () => {
    await expect(resolveMedia('image', { path: file })).resolves.toEqual({ base64: 'AQID', filename: 'pic.png', mimetype: 'image/png' })
    await expect(resolveMedia('image', file)).resolves.toEqual({ base64: 'AQID', filename: 'pic.png', mimetype: 'image/png' })
  })
})

describe('restCall reports caller mistakes as ProviderError', () => {
  const http = { allowHttp: true, allowPrivateHosts: true, resolver: async () => ['127.0.0.1'], fetch: (async () => new Response('{}')) as typeof fetch }

  it('an invalid URL without a label', async () => {
    const err = await restCall('not a url', { method: 'GET' }, http).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/gateway request failed: GET/)
  })

  it('a body that cannot be serialized names the label', async () => {
    const err = await restCall('http://127.0.0.1:9/x', { method: 'POST', body: { n: 1n }, label: 'sendText' }, http).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/sendText/)
    expect((err as Error).message).toMatch(/JSON/)
  })

  it('a redirect says redirects are not followed and points at baseUrl (no "too many redirects")', async () => {
    const redirecting = { ...http, fetch: (async () => new Response(null, { status: 301, headers: { location: 'https://127.0.0.1:8443/x' } })) as typeof fetch }
    const err = await restCall('http://127.0.0.1:9/x?token=abc', { method: 'GET', label: 'ping' }, redirecting).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/GET ping: the gateway answered a redirect \(HTTP 3xx\)/)
    expect((err as Error).message).toMatch(/baseUrl/)
    expect((err as Error).message).not.toMatch(/too many redirects|token=abc/)
  })
})
