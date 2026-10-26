/**
 * `SecureFetchOptions` is a closed set: the request fields `secureFetch` honours
 * (`method`, `headers`, `body`, `signal`) plus its own policy options. It used to
 * extend `RequestInit`, which advertised fields the client overrides (`redirect`
 * is always `'manual'`; `maxRedirects` is the knob) or that mean nothing on Node
 * (`window`, `mode`, `credentials`...). The other `RequestInit` fields still go
 * through, through a deprecated overload, until stable. The runtime names of the
 * entry are pinned so growing it is a deliberate change.
 */
import { describe, expect, it, vi } from 'vitest'

import * as entry from '../src/index.js'
import { fetchBuffer, resolveHost, resolvePublicHost, secureFetch, type SecureFetchOptions } from '../src/index.js'

const resolver = async () => ['93.184.216.34']

describe('@botmesh/http entry', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'SecureHttpError', 'assertSafeTarget', 'fetchBuffer', 'isAllowedHostUrl', 'isPrivateAddress',
      'resolveHost', 'resolvePublicHost', 'secureFetch',
    ])
  })

  it('resolvePublicHost is a deprecated alias of resolveHost', () => {
    expect(resolvePublicHost).toBe(resolveHost)
  })
})

describe('SecureFetchOptions', () => {
  it('forwards method, headers, body and signal to fetch', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok'))
    const options: SecureFetchOptions = {
      method: 'post',
      headers: { 'x-test': '1' },
      body: 'payload',
      signal: new AbortController().signal,
      fetch,
      resolver,
    }
    await secureFetch('https://cdn.example/x', options)
    const init = fetch.mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('x-test')).toBe('1')
    expect(init.body).toBe('payload')
    expect(init.redirect).toBe('manual')
  })

  it('no longer types `redirect`: the client always follows redirects itself', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok'))
    // @ts-expect-error `redirect` is not an option: use `maxRedirects`.
    await secureFetch('https://cdn.example/x', { redirect: 'follow', fetch, resolver })
    expect(fetch.mock.calls[0]![1]!.redirect).toBe('manual')
  })

  it('still forwards other RequestInit fields through the deprecated overload', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok'))
    await secureFetch('https://cdn.example/x', { cache: 'no-store', keepalive: true, fetch, resolver })
    await fetchBuffer('https://cdn.example/x', { cache: 'no-store', fetch, resolver })
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', keepalive: true })
    expect(fetch.mock.calls[1]![1]).toMatchObject({ cache: 'no-store' })
  })

  it('does not accept a `RequestInit` field as a policy option', () => {
    const typed: SecureFetchOptions = {
      maxBytes: 1,
      // @ts-expect-error `mode` is a browser field: not part of SecureFetchOptions.
      mode: 'cors',
    }
    expect(typed.maxBytes).toBe(1)
  })
})
