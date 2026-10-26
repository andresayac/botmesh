import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { WaIdentityStore } from '@botmesh/wa-gateway-kit'
import { WPPConnectProvider } from '../src/WPPConnectProvider.js'
import { parseMessage } from '../src/parseInbound.js'
import { expectWellFormedEvent, mutations } from '../../../test-utils/fuzz.js'
import { fakeFetch, fixture, resolver } from './support/fake.js'

const make = () => {
  const provider = new WPPConnectProvider({
    baseUrl: 'http://127.0.0.1:21465', session: 'my-bot', token: 't', webhookToken: 'w', resolveLid: false, logger: pino({ level: 'silent' }),
  })
  const seen: InboundEvent[] = []
  provider.onEvent((e) => { seen.push(e) })
  return { provider, seen }
}
const headers = { 'x-webhook-token': 'w' }

describe('WPPConnect ingest on malformed payloads', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('a message type named %s is "unknown", not an Object.prototype member', (type) => {
    const [e] = parseMessage({ id: 'false_573001@c.us_A1', from: '573001@c.us', type, body: 'x' }, { identity: new WaIdentityStore() })
    expect(e?.kind === 'message' && e.message.type).toBe('unknown')
  })

  it('seeded random mutations of recorded webhooks: always a status, every event well formed', async () => {
    const { provider, seen } = make()
    const samples = [
      'onmessage-text-dm', 'onmessage-group-image', 'onmessage-lid-dm', 'onmessage-lid-dm-with-pn', 'onack',
      'onreactionmessage', 'incomingcall', 'qrcode', 'status-find',
    ].map((name) => fixture(name))
    for (const body of mutations(20260425, samples, 3000)) {
      expect([200, 400]).toContain(await provider.ingest(body, headers))
    }
    expect(seen.length).toBeGreaterThan(500)
    for (const e of seen) expectWellFormedEvent(e)
  })
})

describe('WPPConnect config errors', () => {
  it('a baseUrl without scheme fails at construction with an actionable message', () => {
    expect(() => new WPPConnectProvider({ baseUrl: 'localhost:21465', session: 's', token: 't', webhookToken: 'w' }))
      .toThrow(/WPPConnectProvider: `baseUrl` must be an absolute http\(s\) URL/)
  })
})

describe('WPPConnect wrong secretKey (real server answers 400 "The SECRET_KEY is incorrect")', () => {
  it('start() rejects with the Unauthorized hint and emits closed/sessionInvalid', async () => {
    const { fetch } = fakeFetch((c) => c.url.endsWith('/generate-token')
      ? { status: 400, body: { message: 'The SECRET_KEY is incorrect' } }
      : { body: {} })
    const provider = new WPPConnectProvider({
      baseUrl: 'http://127.0.0.1:21465', session: 'my-bot', secretKey: 'wrong', webhookToken: 'w', logger: pino({ level: 'silent' }),
      http: { fetch, resolver },
    })
    const events: InboundEvent[] = []
    provider.onEvent((e) => { events.push(e) })
    const err = await provider.start().catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/Unauthorized — check the WPPConnect token\/secretKey/)
    expect((err as Error).message).not.toContain('wrong')
    expect(events.at(-1)).toMatchObject({ kind: 'connection', update: { state: 'closed', reason: 'sessionInvalid' } })
  })
})
