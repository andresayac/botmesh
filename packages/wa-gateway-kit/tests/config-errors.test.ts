import { describe, it, expect } from 'vitest'
import { ProviderError } from '@botmesh/core'
import { gatewayBaseUrl, restCall } from '../src/index.js'

describe('gatewayBaseUrl', () => {
  it('accepts absolute http(s) URLs and strips trailing slashes', () => {
    expect(gatewayBaseUrl('EvolutionProvider', 'http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
    expect(gatewayBaseUrl('EvolutionProvider', 'https://gw.example.com/evo//')).toBe('https://gw.example.com/evo')
  })

  it.each(['localhost:8080', '127.0.0.1:8080', 'ftp://127.0.0.1', '', '   ', 'http://'])('rejects %j with an actionable message', (url) => {
    expect(() => gatewayBaseUrl('EvolutionProvider', url)).toThrow(/EvolutionProvider: `baseUrl` must be an absolute http\(s\) URL/)
  })
})

describe('restCall transport failures', () => {
  it('names the network cause (e.g. ECONNREFUSED) instead of a bare "fetch failed"', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) })
    const err = await restCall('http://127.0.0.1:9/x', { method: 'GET' }, {
      allowHttp: true, allowPrivateHosts: true, resolver: async () => ['127.0.0.1'],
      fetch: (async () => { throw refused }) as typeof fetch,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/ECONNREFUSED/)
  })
})
