import { describe, it, expect } from 'vitest'
import type { InboundEvent, InboundMessage } from '@botmesh/core'
import { GoHighLevelProvider } from '../src/GoHighLevelProvider.js'
import { parseInbound, canonicalChannel, channelOf } from '../src/parseInbound.js'
import { htmlToText } from '../src/html.js'
import { fakeHttp, type Call } from './support.js'
import { keys, LOCATION, SMS_INBOUND } from './fixtures.js'

const K = keys()

/** HighLevel's documented Email `InboundMessage` (the body is HTML, no contentType). */
const EMAIL_INBOUND = {
  type: 'InboundMessage',
  locationId: LOCATION,
  body: '<div style="font-family: verdana, geneva; font-size: 11pt;">Testing Email Notification</div>',
  contactId: '3bN9f8LYJFG8F232XMUbfq',
  conversationId: 'yCdNo6pwyTLYKgg6V2gj',
  dateAdded: '2024-01-12T12:59:04.045Z',
  direction: 'inbound',
  messageType: 'Email',
  emailMessageId: 'sddfDSF3G56GHG',
  messageId: 'email-1',
  from: 'Internal Notify <notify@example.com>',
  threadId: 'sddfDSF3G56GHG',
  subject: 'Order Confirmed',
  to: 'shop@example.com',
}

function messageOf(events: InboundEvent[]): InboundMessage {
  const e = events[0]
  if (!e || e.kind !== 'message') throw new Error('no message event')
  return e.message
}

describe('GoHighLevelProvider — configuration is validated up front', () => {
  it('rejects a non-string, blank or Bearer-prefixed accessToken with an actionable message', () => {
    expect(() => new GoHighLevelProvider({ accessToken: 123 as unknown as string, locationId: LOCATION })).toThrow(/accessToken/)
    expect(() => new GoHighLevelProvider({ accessToken: '   ', locationId: LOCATION })).toThrow(/accessToken/)
    expect(() => new GoHighLevelProvider({ accessToken: 'Bearer pit-abc', locationId: LOCATION })).toThrow(/without the "Bearer " prefix/)
  })

  it('refuses a token that is not a valid header value and never echoes it', () => {
    let message = ''
    try {
      new GoHighLevelProvider({ accessToken: 'pit-SECRET\r\nX-Evil: 1', locationId: LOCATION })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/accessToken/)
    expect(message).not.toContain('SECRET')
  })

  it('trims surrounding whitespace (an env var with a trailing newline)', async () => {
    const { calls, http } = fakeHttp(() => ({ json: { messageId: 'm1' } }))
    const p = new GoHighLevelProvider({ accessToken: '  pit-abc\n', locationId: ` ${LOCATION}\n`, http })
    await p.send('c1', { kind: 'text', text: 'hi' })
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer pit-abc')
  })

  it('rejects a baseUrl that is not an absolute http(s) URL', () => {
    expect(() => new GoHighLevelProvider({ accessToken: 't', locationId: LOCATION, baseUrl: 'services.leadconnectorhq.com' })).toThrow(/baseUrl/)
    expect(() => new GoHighLevelProvider({ accessToken: 't', locationId: LOCATION, baseUrl: 'ftp://example.com' })).toThrow(/baseUrl/)
  })

  it('rejects a non-string locationId', () => {
    expect(() => new GoHighLevelProvider({ accessToken: 't', locationId: 42 as unknown as string })).toThrow(/locationId/)
  })
})

describe('GoHighLevelProvider — channel names are canonicalised', () => {
  it('accepts any casing / alias for defaultChannel and platformData.type', async () => {
    const { calls, http } = fakeHttp((_c: Call) => ({ json: { messageId: 'm1' } }))
    const p = new GoHighLevelProvider({ accessToken: 't', locationId: LOCATION, http, defaultChannel: 'whatsapp' })
    await p.send('c1', { kind: 'text', text: 'hi' })
    await p.send('c1', { kind: 'text', text: 'hi' }, { platformData: { type: 'email', subject: 's' } })
    await p.send('c1', { kind: 'text', text: 'hi' }, { platformData: { type: 'Live Chat' } })
    expect(calls.map((c) => JSON.parse(c.body).type)).toEqual(['WhatsApp', 'Email', 'Live_Chat'])
    expect(p.textFormatFor('c1')).toBe('whatsapp')
  })

  it('passes an unknown channel name through unchanged', async () => {
    const { calls, http } = fakeHttp(() => ({ json: { messageId: 'm1' } }))
    const p = new GoHighLevelProvider({ accessToken: 't', locationId: LOCATION, http, defaultChannel: 'RCS' })
    await p.send('c1', { kind: 'text', text: 'hi' })
    expect(JSON.parse(calls[0]!.body).type).toBe('RCS')
  })
})

describe('GoHighLevelProvider — Email bodies arrive as text', () => {
  it('turns the HTML body of an Email InboundMessage into plain text (raw keeps the HTML)', () => {
    const msg = messageOf(parseInbound(EMAIL_INBOUND).events)
    expect(msg.body).toBe('Testing Email Notification')
    expect((msg.raw as { body: string }).body).toBe(EMAIL_INBOUND.body)
    expect(msg.chat.platformData).toMatchObject({ channel: 'Email', subject: 'Order Confirmed' })
  })

  it('keeps line structure and decodes entities', () => {
    const msg = messageOf(parseInbound({
      ...EMAIL_INBOUND,
      body: '<html><head><style>p{color:red}</style></head><body><p>Hola &amp; adi&oacute;s</p><div>l&iacute;nea 2<br>l3</div><script>alert(1)</script></body></html>',
    }).events)
    expect(msg.body).toBe('Hola & adiós\nlínea 2\nl3')
  })

  it('leaves plain-text bodies (SMS, or text/plain email) untouched', () => {
    expect(messageOf(parseInbound({ ...SMS_INBOUND, body: 'a <b> c & d' }).events).body).toBe('a <b> c & d')
    expect(messageOf(parseInbound({ ...EMAIL_INBOUND, contentType: 'text/plain', body: '1 < 2 & 3 > 2' }).events).body).toBe('1 < 2 & 3 > 2')
  })

  it('a text trigger matches an Email message end to end', async () => {
    const { http } = fakeHttp(() => ({ json: { messageId: 'm1' } }))
    const p = new GoHighLevelProvider({ accessToken: 't', locationId: LOCATION, publicKey: K.publicKey, http })
    const events: InboundEvent[] = []
    p.onEvent((e) => { events.push(e) })
    const raw = JSON.stringify({ ...EMAIL_INBOUND, body: '<div dir="ltr">hello</div>' })
    expect(p.ingest(Buffer.from(raw), { 'x-ghl-signature': K.signEd(raw) })).toBe(200)
    expect(messageOf(events).body).toBe('hello')
  })

  it('htmlToText stays linear on hostile input', () => {
    const hostile = '<script>'.repeat(20_000) + '<a href="'.repeat(20_000) + '<'.repeat(50_000) + '&#x'.repeat(20_000)
    const started = performance.now()
    htmlToText(hostile)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('Object.prototype names are not entities: &constructor; and friends stay literal', () => {
    const body = '<p>Pay &constructor; &toString; &__proto__; &hasOwnProperty; &valueOf; now &amp; &Eacute;</p>'
    expect(htmlToText(body)).toBe('Pay &constructor; &toString; &__proto__; &hasOwnProperty; &valueOf; now & É')
    const { events } = parseInbound({ ...EMAIL_INBOUND, body: '<p>Hi &constructor; &toString;</p>' })
    expect(messageOf(events).body).toBe('Hi &constructor; &toString;')
  })

  it('Object.prototype names are not channel aliases', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(canonicalChannel(name)).toBe(name)
      expect(channelOf({ messageType: name, messageTypeString: name })).toBeUndefined()
    }
    expect(channelOf({ messageType: 'constructor', messageTypeString: 'TYPE_SMS' })).toBe('SMS')
    expect(canonicalChannel('Live Chat')).toBe('Live_Chat')
  })
})
