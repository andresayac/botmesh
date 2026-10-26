/**
 * Defects left open by the alpha exit review: the interaction token leaked into
 * `interactionId`, interactions were not acknowledged unless the bot did it within
 * Discord's 3 s, REST calls had no timeout, and long button/option lists were cut
 * silently.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboundInteraction } from '@botmesh/core'
import { ProviderError, UnsupportedContentError } from '@botmesh/core'
import { DiscordProvider } from '../src/DiscordProvider.js'
import { toOutbound } from '../src/toOutbound.js'
import { fakeSocketFactory } from './_fakeSocket.js'

interface Call { url: string; body: unknown }

function mockFetch(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'OUT' }), arrayBuffer: async () => new ArrayBuffer(0) }
  }))
  return calls
}

const live: DiscordProvider[] = []
async function booted(over: Record<string, unknown> = {}) {
  const { sockets, factory } = fakeSocketFactory()
  const p = new DiscordProvider({ token: 'TOK', socketFactory: factory, reconnectDelayMs: 0, ...over } as never)
  live.push(p)
  const interactions: InboundInteraction[] = []
  p.onEvent((e) => { if (e.kind === 'interaction') interactions.push(e.interaction) })
  await p.start()
  sockets[0]!.serverSend({ op: 10, d: { heartbeat_interval: 60_000 } })
  const click = (id: string, type = 3, data: Record<string, unknown> = { custom_id: 'btn', component_type: 2 }) =>
    sockets[0]!.serverSend({
      op: 0, t: 'INTERACTION_CREATE', s: 1,
      d: { id, type, token: `TOKEN-${id}`, channel_id: 'C1', guild_id: 'G1', member: { user: { id: 'U1', username: 'ana' } }, data, message: { id: 'M9' } },
    })
  return { p, interactions, click }
}

afterEach(async () => {
  while (live.length) await live.pop()!.stop()
  vi.unstubAllGlobals()
})

describe('the interaction token stays inside the provider', () => {
  it('interactionId is the interaction id only, and raw / ref.native carry no token', async () => {
    mockFetch()
    const { interactions, click } = await booted({ autoAcknowledgeMs: false })
    click('175928847299117063')
    const i = interactions[0]!
    expect(i.interactionId).toBe('175928847299117063')
    expect(JSON.stringify(i)).not.toContain('TOKEN-')
  })

  it('acknowledgeInteraction(id) and send(..., { interactionId }) use the remembered token', async () => {
    const calls = mockFetch()
    const { p, click } = await booted({ autoAcknowledgeMs: false, appId: 'APP' })
    click('111')
    await p.acknowledgeInteraction('111', { text: 'ok' })
    expect(calls.at(-1)!.url).toBe('https://discord.com/api/v10/interactions/111/TOKEN-111/callback')
    await p.send('C1', { kind: 'text', text: 'follow' }, { interactionId: '111' })
    expect(calls.at(-1)!.url).toContain('/webhooks/APP/TOKEN-111')
  })

  it('no longer accepts the alpha "<id>:<token>" form (a token never comes from bot code)', async () => {
    const calls = mockFetch()
    const { p } = await booted({ autoAcknowledgeMs: false })
    await expect(p.acknowledgeInteraction('IID:TT')).rejects.toBeInstanceOf(ProviderError)
    expect(calls).toEqual([])
  })

  it('the deprecated autoAckMs alias is gone: it no longer configures the auto-ack', () => {
    expect(() => new DiscordProvider({ token: 'T', autoAckMs: 5000 } as never)).not.toThrow()
  })

  it('rejects an id it has no token for (expired or from another process)', async () => {
    mockFetch()
    const { p } = await booted({ autoAcknowledgeMs: false })
    await expect(p.acknowledgeInteraction('999')).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('auto-acknowledge before the 3 s deadline', () => {
  it('defers a component interaction the bot did not answer in time (type 6), a command with type 5', async () => {
    const calls = mockFetch()
    const { click } = await booted({ autoAcknowledgeMs: 20 })
    click('201')
    click('202', 2, { name: 'menu' })
    await vi.waitFor(() => expect(calls.filter((c) => c.url.endsWith('/callback'))).toHaveLength(2))
    const byId = Object.fromEntries(calls.map((c) => [c.url.split('/')[6], c.body]))
    expect(byId['201']).toEqual({ type: 6 })
    expect(byId['202']).toEqual({ type: 5 })
  })

  it('does not auto-ack an interaction the bot already acknowledged; a later text goes out as a followup', async () => {
    const calls = mockFetch()
    const { p, click } = await booted({ autoAcknowledgeMs: 20, appId: 'APP' })
    click('301')
    await p.acknowledgeInteraction('301')
    click('302')
    await vi.waitFor(() => expect(calls.filter((c) => c.url.includes('/interactions/302/'))).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 40))
    expect(calls.filter((c) => c.url.includes('/interactions/301/'))).toHaveLength(1)
    // 302 was auto-deferred: answering it now cannot use the callback again.
    await p.acknowledgeInteraction('302', { text: 'listo' })
    expect(calls.at(-1)!.url).toBe('https://discord.com/api/v10/webhooks/APP/TOKEN-302')
    expect(calls.at(-1)!.body).toMatchObject({ content: 'listo' })
  })
})

describe('REST timeout', () => {
  it('a request that never answers rejects with a typed ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })))
    const { p } = await booted({ autoAcknowledgeMs: false, requestTimeoutMs: 30 })
    const err = await p.send('C1', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/timed out after 30ms/)
    expect((err as Error).message).not.toContain('TOK')
  })
})

describe('long lists are rejected, not cut', () => {
  it('more than 25 buttons or 25 options reject with UnsupportedContentError', () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ id: `b${i}`, title: `B${i}` }))
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: many })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ rows: many }] })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: many.slice(0, 25) })).not.toThrow()
  })
})
