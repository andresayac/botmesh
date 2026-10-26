import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { GupshupProvider } from '../src/GupshupProvider.js'
import { parseInbound } from '../src/parseInbound.js'
import type { GupshupCallback } from '../src/types.js'
import * as fx from './fixtures.js'
import { eventProblem, int, mutate, pick, randomBytes, randomString, rng } from './fuzz.js'

const FIXTURES = Object.values(fx).filter((v) => typeof v === 'object' && v !== null) as unknown[]

function harness() {
  const provider = new GupshupProvider({ apiKey: 'k', appName: 'app', source: '91', webhookToken: 'secret-token', logger: pino({ level: 'silent' }) })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e as InboundEvent) })
  return { provider, events }
}

describe('GupshupProvider — fuzzed callbacks', () => {
  it('never throws and only emits well-formed events', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const payload = mutate(r, pick(r, FIXTURES))
      const body = r() < 0.7 ? Buffer.from(JSON.stringify(payload) ?? '') : payload
      let status = 0
      expect(() => { status = provider.ingestRequest({ url: '/gupshup?token=secret-token', body }) }, `seed ${seed}`).not.toThrow()
      expect([200, 400], `seed ${seed}`).toContain(status)
      for (const e of events) expect(eventProblem(e), `seed ${seed}`).toBeUndefined()
    }
  })

  it('parseInbound tolerates any value', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed)
      const payload = mutate(r, pick(r, FIXTURES)) as GupshupCallback
      expect(() => parseInbound(payload), `seed ${seed}`).not.toThrow()
    }
  })

  it('rejects random bodies and tokens without throwing', () => {
    for (let seed = 1; seed <= 800; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const url = pick(r, ['/gupshup', `/gupshup?token=${encodeURIComponent(randomString(r).replace(/[\uD800-\uDFFF]/g, '?'))}`, randomString(r), 'http://[::1', '?token=secret-token&token=x'])
      const body = pick(r, [randomBytes(r), int(r, 3), null, [], 'x'])
      let status = 0
      expect(() => { status = provider.ingestRequest({ url, body, headers: { 'x-webhook-token': randomString(r) } }) }, `seed ${seed}`).not.toThrow()
      expect([200, 400, 401], `seed ${seed}`).toContain(status)
      if (status === 200) expect(events.filter((e) => e.kind !== 'connection'), `seed ${seed}`).toEqual([])
    }
  })
})

describe('GupshupProvider — hostile shapes', () => {
  it('parseInbound returns [] for non-object envelopes', () => {
    for (const v of [null, undefined, 1, 'x', []]) expect(parseInbound(v as unknown as GupshupCallback)).toEqual([])
  })

  it('a contact card with null / odd entries still parses', () => {
    const body = { type: 'message', payload: { id: 'w1', type: 'contact', sender: { phone: '57300' }, payload: { contacts: [null, 1, { name: null }, { name: { formatted_name: 'Ana' } }] } } }
    const [e] = parseInbound(body as GupshupCallback)
    expect(e?.kind === 'message' && e.message.body).toBe('Ana')
  })

  it('non-string text / caption / reaction fields never leak non-strings into events', () => {
    const text = parseInbound({ type: 'message', payload: { id: 'w2', type: 'text', sender: { phone: '57300' }, payload: { text: { a: 1 } } } } as GupshupCallback)
    expect(eventProblem(text[0] as never)).toBeUndefined()
    const btn = parseInbound({ type: 'message', payload: { id: 'w3', type: 'quick_reply', sender: { phone: '57300' }, payload: { postbackText: ['x'] } } } as GupshupCallback)
    expect(eventProblem(btn[0] as never)).toBeUndefined()
  })
})
