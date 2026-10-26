/**
 * Release-test findings: parameter names that collide with Object.prototype,
 * the query string of a `webhookPath` request, configuration typos that would
 * otherwise only show up as a 403/401 on every request, and the 401 hint.
 */
import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { TwilioProvider } from '../src/TwilioProvider.js'
import { computeTwilioSignature, paramsFromObject, parseFormParams } from '../src/signature.js'
import { TwilioApiError, toTwilioError } from '../src/errors.js'

const silent = pino({ level: 'silent' })

/** What Twilio signs for a form body: URL + every name + value, names sorted, unique values sorted. */
function referenceSignature(token: string, url: string, raw: string): string {
  const byName = new Map<string, Set<string>>()
  for (const [k, v] of new URLSearchParams(raw)) {
    if (!byName.has(k)) byName.set(k, new Set())
    byName.get(k)!.add(v)
  }
  let data = url
  for (const k of [...byName.keys()].sort()) for (const v of [...byName.get(k)!].sort()) data += k + v
  return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64')
}

describe('webhook params named like Object.prototype members', () => {
  const raw = 'MessageSid=SM1&From=%2B1&Body=hi&constructor=x&__proto__=y&toString=z&hasOwnProperty=w&valueOf=v&valueOf=u'

  it('parseFormParams keeps them as own string properties and never touches the prototype', () => {
    const params = parseFormParams(raw)
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(Object.keys(params).sort()).toEqual(['Body', 'From', 'MessageSid', '__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf'].sort())
    expect(params['constructor']).toBe('x')
    expect(Object.getOwnPropertyDescriptor(params, '__proto__')?.value).toBe('y')
    expect(params['valueOf']).toEqual(['v', 'u'])
  })

  it('paramsFromObject keeps an own __proto__ key (JSON.parse creates one) and the prototype intact', () => {
    const params = paramsFromObject(JSON.parse('{"__proto__":"a","constructor":"b","MessageSid":"SM1"}') as Record<string, unknown>)
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(Object.keys(params).sort()).toEqual(['MessageSid', '__proto__', 'constructor'])
  })

  it('a webhook carrying them verifies against the signature Twilio computes', () => {
    const url = 'https://h.example/x'
    const provider = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', webhookUrl: url, logger: silent })
    expect(computeTwilioSignature('tok', url, parseFormParams(raw))).toBe(referenceSignature('tok', url, raw))
    expect(provider.ingest(raw, { 'x-twilio-signature': referenceSignature('tok', url, raw) })).toBe(200)
  })
})

describe('webhookPath + the request URL the host passes (third ingest argument)', () => {
  const params = { MessageSid: `SM${'a'.repeat(32)}`, From: 'whatsapp:+15550001111', To: 'whatsapp:+14155238886', Body: 'hola', NumMedia: '0' }
  const raw = new URLSearchParams(params).toString()

  it('keeps the query string Twilio called (e.g. ?tenant=a) when webhookPath has none', () => {
    const provider = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', webhookPath: '/twilio', logger: silent })
    const events: InboundEvent[] = []
    provider.onEvent((e) => { events.push(e) })
    const signedUrl = 'https://bot.example.com/twilio?tenant=a'
    const headers = { host: 'bot.example.com', 'x-twilio-signature': computeTwilioSignature('tok', signedUrl, params) }
    expect(provider.ingest(raw, headers)).toBe(403) // query unknown: cannot verify
    expect(provider.ingest(raw, headers, '/twilio?tenant=a')).toBe(200)
    expect(events.filter((e) => e.kind === 'message')).toHaveLength(1)
  })

  it('takes only the query from the request URL: the public path stays webhookPath (proxies rewrite paths)', () => {
    const provider = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', webhookPath: '/api/twilio', logger: silent })
    const signedUrl = 'https://bot.example.com/api/twilio?tenant=b'
    const headers = { host: 'bot.example.com', 'x-twilio-signature': computeTwilioSignature('tok', signedUrl, params) }
    expect(provider.ingest(raw, headers, '/twilio?tenant=b')).toBe(200)
  })

  it('a webhookUrl stays authoritative: the request URL never changes what is verified', () => {
    const provider = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', webhookUrl: 'https://bot.example.com/twilio', logger: silent })
    const headers = { 'x-twilio-signature': computeTwilioSignature('tok', 'https://bot.example.com/twilio', params) }
    expect(provider.ingest(raw, headers, '/twilio?tenant=a')).toBe(200)
  })
})

describe('configuration typos fail at construction with an actionable message', () => {
  const base = { accountSid: 'AC1', authToken: 'tok', webhookUrl: 'https://bot.example.com/hook', logger: silent }
  it('rejects whitespace in authToken / accountSid (e.g. a trailing newline from a secrets file)', () => {
    expect(() => new TwilioProvider({ ...base, authToken: 'tok\n' })).toThrow(/authToken.*whitespace/)
    expect(() => new TwilioProvider({ ...base, accountSid: ' AC1' })).toThrow(/accountSid.*whitespace/)
    expect(() => new TwilioProvider({ ...base, apiKeySid: 'SK1', apiKeySecret: 'sec ' })).toThrow(/apiKeySecret.*whitespace/)
  })
  it('rejects whitespace in webhookUrl (the signature covers it byte for byte)', () => {
    expect(() => new TwilioProvider({ ...base, webhookUrl: 'https://bot.example.com/hook ' })).toThrow(/webhookUrl.*whitespace/)
  })
  it('rejects an smsFrom that carries the whatsapp: prefix', () => {
    expect(() => new TwilioProvider({ ...base, smsFrom: 'whatsapp:+15017122661' })).toThrow(/smsFrom.*whatsappFrom/)
  })
})

describe('REST authentication failures point at the credentials', () => {
  it('a 401 says which settings to check', () => {
    const err = toTwilioError(401, { code: 20003, message: 'Authenticate' }, 'whatsapp:+1')
    expect(err).toBeInstanceOf(TwilioApiError)
    expect(err.message).toMatch(/Twilio 20003: Authenticate/)
    expect(err.message).toMatch(/accountSid.*authToken.*apiKeySid/)
  })
})

describe('native payload names like Object.prototype members', () => {
  it('stay own params of the Messages API call (no prototype swap, nothing dropped)', async () => {
    const { toOutbound } = await import('../src/toOutbound.js')
    const payload = JSON.parse('{"__proto__":"x","ContentSid":"HX1"}') as Record<string, unknown>
    const out = toOutbound({ kind: 'native', provider: 'twilio', payload })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out).sort()).toEqual(['ContentSid', '__proto__'])
  })
})

describe('documented per-send sender override', () => {
  it('bot.send(..., { platformData: { From } }) sends from that number', async () => {
    const { fakeHttp } = await import('./support.js')
    const { Bot } = await import('@botmesh/core')
    const { calls, http } = fakeHttp(() => ({ status: 201, json: { sid: 'SM1' } }))
    const provider = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', whatsappFrom: 'whatsapp:+14155238886', webhookUrl: 'https://h.example/x', http, logger: silent })
    const bot = new Bot({ provider, logger: silent })
    await bot.start()
    await bot.send('whatsapp:+15550001', 'hola', { platformData: { From: 'whatsapp:+15559999' } })
    await bot.send('whatsapp:+15550001', 'hola')
    expect(calls.map((c) => new URLSearchParams(c.body).get('From'))).toEqual(['whatsapp:+15559999', 'whatsapp:+14155238886'])
    await bot.stop()
  })
})
