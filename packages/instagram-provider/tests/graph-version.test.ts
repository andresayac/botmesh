/** Graph API version: the default is the shared current version, an explicit apiVersion wins. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GRAPH_API_VERSION } from '@botmesh/graph-core'
import { InstagramProvider } from '../src/InstagramProvider.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(): string[] {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ message_id: 'm.OUT', recipient_id: 'R' }) }
  }))
  return urls
}

const cfg = { accessToken: 'TOK', verifyToken: 'vt', allowUnsignedWebhooks: true }

describe('InstagramProvider Graph version', () => {
  it('defaults to DEFAULT_GRAPH_API_VERSION (v26.0)', async () => {
    expect(DEFAULT_GRAPH_API_VERSION).toBe('v26.0')
    const urls = stubFetch()
    await new InstagramProvider(cfg).send('1234', { kind: 'text', text: 'hi' })
    expect(urls[0]).toBe('https://graph.facebook.com/v26.0/me/messages')
  })

  it('keeps an explicit apiVersion', async () => {
    const urls = stubFetch()
    await new InstagramProvider({ ...cfg, apiVersion: 'v24.0' }).send('1234', { kind: 'text', text: 'hi' })
    expect(urls[0]).toBe('https://graph.facebook.com/v24.0/me/messages')
  })
})
