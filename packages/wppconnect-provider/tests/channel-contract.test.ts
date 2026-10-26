/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) against the real ingest path, and the declared text limit.
 */
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { assertCapabilityContract, assertInboundContract, recordEvents } from '@botmesh/core/testing'
import { WPPConnectProvider } from '../src/WPPConnectProvider.js'
import { fakeFetch, fixture, resolver } from './support/fake.js'

const H = { 'x-webhook-token': 'wh' }
function provider() {
  const { fetch } = fakeFetch(() => ({ status: 500, body: {} }))
  return new WPPConnectProvider({ session: 'my-bot', token: 'T', webhookToken: 'wh', resolveLid: false, http: { fetch, resolver }, logger: pino({ level: 'silent' }) })
}

describe('WPPConnect — channel contract', () => {
  it('emits epoch ms for messages and acks', async () => {
    const p = provider()
    const rec = recordEvents(p)
    for (const f of ['onmessage-text-dm', 'onmessage-group-image', 'onack']) await p.ingest(fixture(f), H)
    const checked = rec.events.filter((e) => e.kind === 'message' || e.kind === 'status')
    expect(checked.length).toBeGreaterThanOrEqual(3)
    assertInboundContract(checked)
    expect(rec.messages()[0]?.timestamp).toBe(1_760_700_000_000)
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
