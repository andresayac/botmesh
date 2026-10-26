/**
 * Release hardening: the `@botmesh/server` ingress hands the request URL to
 * `ingest()` as a third argument (the documented `?token=` callback URL used to
 * answer 401 there), WhatsApp label limits (Gupshup rejects a 21-character
 * quick-reply title with an opaque "Invalid request"), URL buttons that degrade
 * to text keep their link, and failed-status reasons are always strings.
 */
import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { UnsupportedContentError, type InboundEvent } from '@botmesh/core'
import { GupshupProvider } from '../src/GupshupProvider.js'
import { parseInbound } from '../src/parseInbound.js'
import { toOutbound } from '../src/toOutbound.js'
import { EV_FAILED, TEXT } from './fixtures.js'
import { toGupshupError } from '../src/errors.js'
import { fakeHttp } from './support.js'
import { int, randomString, rng } from './fuzz.js'

const TOKEN = 'cb-secret-123'
const json = (v: unknown) => Buffer.from(JSON.stringify(v))

function make() {
  const provider = new GupshupProvider({ apiKey: 'k', appName: 'DemoApp', source: '917834811114', webhookToken: TOKEN, logger: pino({ level: 'silent' }) })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e as InboundEvent) })
  return { provider, events }
}

describe('ingest(body, headers, requestUrl) — the @botmesh/server ingress signature', () => {
  it('accepts the token from the query string of the request URL', () => {
    const { provider, events } = make()
    expect(provider.ingest(json(TEXT), {}, `/gupshup?token=${TOKEN}`)).toBe(200)
    expect(events).toHaveLength(1)
  })

  it('still rejects a wrong query token, and a missing one without the header', () => {
    const { provider, events } = make()
    expect(provider.ingest(json(TEXT), {}, '/gupshup?token=nope')).toBe(401)
    expect(provider.ingest(json(TEXT), {}, '/gupshup')).toBe(401)
    expect(provider.ingest(json(TEXT), {}, 'http://[::1')).toBe(401)
    expect(events).toHaveLength(0)
  })

  it('falls back to the header when the URL carries no token', () => {
    const { provider } = make()
    expect(provider.ingest(json(TEXT), { 'x-webhook-token': TOKEN }, '/gupshup')).toBe(200)
  })
})

describe('WhatsApp label limits', () => {
  const chars = (s: unknown) => Array.from(String(s)).length

  it('cuts quick-reply titles to 20 characters on a grapheme boundary', () => {
    const out = toOutbound({
      kind: 'buttons', text: 'Elige',
      buttons: [{ id: 'a', title: 'Confirmar la reservación ahora' }, { id: 'b', title: 'Cancelar 🙅‍♀️🙅‍♀️🙅‍♀️🙅‍♀️' }],
    })
    const options = (out as unknown as { message: { options: Array<{ title: string; postbackText: string }> } }).message.options
    expect(options.map((o) => o.postbackText)).toEqual(['a', 'b'])
    expect(options[0]!.title).toBe('Confirmar la reserva')
    expect(chars(options[1]!.title)).toBeLessThanOrEqual(20)
    // Never half an emoji ZWJ sequence.
    expect(options[1]!.title).toBe('Cancelar 🙅‍♀️🙅‍♀️')
  })

  it('cuts list labels (button 20, section and row titles 24, descriptions 72, footer 60)', () => {
    const long = 'x'.repeat(100)
    const out = toOutbound({
      kind: 'list', text: 'Menu', buttonText: long, footer: long,
      sections: [{ title: long, rows: [{ id: 'r1', title: long, description: long }] }],
    }) as { message: Record<string, any> }
    const m = out.message
    expect(chars(m['globalButtons'][0].title)).toBe(20)
    expect(chars(m['footer'])).toBe(60)
    expect(chars(m['items'][0].title)).toBe(24)
    expect(chars(m['items'][0].options[0].title)).toBe(24)
    expect(chars(m['items'][0].options[0].description)).toBe(72)
    expect(m['items'][0].options[0].postbackText).toBe('r1')
  })

  it('rejects quick replies whose titles repeat (after the cut) with an actionable error', () => {
    expect(() => toOutbound({
      kind: 'buttons', text: 'Elige',
      buttons: [{ id: 'a', title: 'Reservar una mesa para dos' }, { id: 'b', title: 'Reservar una mesa para cuatro' }],
    })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'Sí' }, { id: 'b', title: 'Sí' }] })).toThrow(/unique.*"Sí"/)
  })

  it('cuts the quick-reply footer (content.caption) to 60 characters', () => {
    const out = toOutbound({ kind: 'buttons', text: 'Hi', footer: 'f'.repeat(80), buttons: [{ id: 'a', title: 'A' }] }) as { message: Record<string, any> }
    expect(chars(out.message['content'].caption)).toBe(60)
  })
})

describe('URL buttons degraded to numbered text', () => {
  it('keep the link next to the title', () => {
    const out = toOutbound({
      kind: 'buttons', text: 'Pay here',
      buttons: [{ id: 'pay', title: 'Pay', url: 'https://pay.example.com/i/1' }, { id: 'help', title: 'Help' }],
    }) as unknown as { message: { type: string; text: string } }
    expect(out.message.type).toBe('text')
    expect(out.message.text).toContain('1. Pay: https://pay.example.com/i/1')
    expect(out.message.text).toContain('2. Help')
  })
})

describe('failed statuses', () => {
  it('carry a string message and a numeric code only', () => {
    const odd = { ...EV_FAILED, payload: { ...EV_FAILED.payload, payload: { code: { nested: 1 }, reason: { text: 'x' } } } }
    const [event] = parseInbound(odd as never)
    expect(event?.kind).toBe('status')
    const error = (event as { status: { error?: Record<string, unknown> } }).status.error
    expect(error).toEqual({})
    const [ok] = parseInbound(EV_FAILED as never)
    expect((ok as { status: { error?: unknown } }).status.error).toEqual({ code: 470, message: EV_FAILED.payload.payload.reason })
  })
})

describe('actionable errors', () => {
  it('a 401/403 from the API says to check the API key', () => {
    expect(toGupshupError(401, 'Authentication Failed', '57300').message).toMatch(/apiKey/)
    expect(toGupshupError(403, 'Forbidden', '57300').message).toMatch(/apiKey/)
  })

  it('a refused connection names the network error code', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) })
    const { http } = fakeHttp(() => { throw refused })
    const provider = new GupshupProvider({ apiKey: 'k', appName: 'a', source: '1', webhookToken: 't', http, logger: pino({ level: 'silent' }) })
    const err = await provider.send('573001', { kind: 'text', text: 'x' }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/fetch failed \(ECONNREFUSED\)/)
  })
})

describe('outbound fuzz', () => {
  it('interactive labels always fit the limits and stay well-formed UTF-16', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(seed)
      const label = () => { const s = randomString(r).replace(/[\uD800-\uDFFF]/g, '?'); return s === '' ? 'x' : s }
      const count = 1 + int(r, 12)
      const buttons = Array.from({ length: count }, (_, i) => ({ id: `b${i}`, title: `${i}${label()}` }))
      let out
      try {
        out = r() < 0.5
          ? toOutbound({ kind: 'buttons', text: 'pick', buttons, ...(r() < 0.5 ? { footer: label() } : {}) })
          : toOutbound({ kind: 'list', text: 'pick', buttonText: label(), sections: [{ title: label(), rows: buttons.slice(0, 10).map((b) => ({ ...b, description: label() })) }] })
      } catch (err) {
        expect(err, `seed ${seed}`).toBeInstanceOf(UnsupportedContentError)
        continue
      }
      const m = (out as unknown as { message: Record<string, any> }).message
      const texts: Array<[string, number]> = []
      if (m['type'] === 'quick_reply') for (const o of m['options']) texts.push([o.title, 20])
      if (m['type'] === 'list') {
        texts.push([m['globalButtons'][0].title, 20])
        for (const item of m['items']) {
          texts.push([item.title, 24])
          for (const o of item.options) { texts.push([o.title, 24]); if (o.description) texts.push([o.description, 72]) }
        }
        if (m['footer']) texts.push([m['footer'], 60])
      }
      for (const [text, max] of texts) {
        expect(Array.from(text).length, `seed ${seed}`).toBeLessThanOrEqual(max)
        expect(lone.test(text), `seed ${seed}`).toBe(false)
      }
    }
  })
})
