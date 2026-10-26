/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) against the real ingest path, and the declared text limit.
 */
import { describe, it, expect, vi } from 'vitest'
import { assertCapabilityContract, assertPresenceWhileDisconnected, assertInboundContract, recordEvents } from '@botmesh/core/testing'
import { EvolutionProvider } from '../src/EvolutionProvider.js'
import { fixture } from './support/fake.js'

const SECRET = 's3cret'
const H = { 'x-webhook-secret': SECRET }
const provider = () => new EvolutionProvider({ baseUrl: 'http://localhost:8080', apiKey: 'k', instance: 'my-instance', webhookSecret: SECRET })

describe('Evolution — channel contract', () => {
  it('emits epoch ms for messages and delivery statuses', () => {
    const p = provider()
    const rec = recordEvents(p)
    for (const f of ['messages-upsert-text-dm', 'messages-upsert-group-image', 'messages-update']) p.ingest(fixture(f), H)
    const checked = rec.events.filter((e) => e.kind === 'message' || e.kind === 'status')
    expect(checked.length).toBeGreaterThanOrEqual(3)
    assertInboundContract(checked)
    const first = rec.messages()[0]
    expect(first?.timestamp).toBe(1_760_700_000_000)
  })

  it('declares the WhatsApp text limit', () => {
    expect(provider().capabilities.maxTextLength).toBe(65_536)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(provider())
  })
})

describe('presence while disconnected', () => {
  it('markRead / typing resolve without contacting the transport before start()', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline: the transport must not be contacted') })
    try {
      await assertPresenceWhileDisconnected(provider(), { chatId: 'chat-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
