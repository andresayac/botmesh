import { describe, it, expect } from 'vitest'
import type { InboundEvent } from '@botmesh/core'
import { UnsupportedContentError } from '@botmesh/core'
import { MessengerProvider } from '../src/MessengerProvider.js'
import { toOutbound } from '../src/toOutbound.js'
import { parseInbound, type PageWebhookBody } from '../src/parseInbound.js'
import { expectWellFormedEvent, mutations } from '../../../test-utils/fuzz.js'

const page = (...messaging: unknown[]): PageWebhookBody => ({ object: 'page', entry: [{ id: 'PG', time: 1, messaging: messaging as never }] })

describe('Messenger message_reactions webhook (Meta shape)', () => {
  it('a top-level `reaction` (react) is a reaction event carrying the unicode emoji', () => {
    const events = parseInbound(page({
      sender: { id: 'USER1' }, recipient: { id: 'PG' }, timestamp: 1458668856463,
      reaction: { reaction: 'love', emoji: '❤️', action: 'react', mid: 'm_target' },
    }))
    expect(events).toHaveLength(1)
    const [ev] = events
    expect(ev.kind).toBe('reaction')
    if (ev.kind !== 'reaction') return
    expect(ev.reaction.ref).toMatchObject({ id: 'm_target', chatId: 'USER1' })
    expect(ev.reaction.emoji).toBe('❤️')
    expect(ev.reaction.senderId).toBe('USER1')
    expect(ev.reaction.removed).toBe(false)
  })

  it('action "unreact" flags the reaction as removed', () => {
    const [ev] = parseInbound(page({
      sender: { id: 'USER1' }, recipient: { id: 'PG' }, timestamp: 2,
      reaction: { reaction: 'love', emoji: '❤️', action: 'unreact', mid: 'm_target' },
    }))
    expect(ev?.kind === 'reaction' && ev.reaction.removed).toBe(true)
  })
})

describe('Messenger ingest never throws on malformed bodies', () => {
  const samples: PageWebhookBody[] = [
    page(
      { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 5, message: { mid: 'm1', text: 'hi', attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/a.jpg' } }], reply_to: { mid: 'x' } } },
      { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 6, message: { mid: 'm2', text: 'q', quick_reply: { payload: 'Q' } } },
      { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 7, postback: { mid: 'pb', payload: 'P', title: 't' } },
      { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 8, reaction: { mid: 'm1', action: 'react', reaction: 'love', emoji: '❤' } },
      { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 9, message: { mid: 'm9', attachments: [{ type: 'location', payload: { title: 'x', coordinates: { lat: 1, long: 2 } } }] } },
      { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 10, optin: { ref: 'r', payload: 'o' } },
    ),
  ]

  it('handles hand-picked hostile shapes', () => {
    const provider = new MessengerProvider({ accessToken: 'T', verifyToken: 'v', allowUnsignedWebhooks: true })
    for (const body of [
      { object: 'page', entry: {} },
      { object: 'page', entry: [null] },
      { object: 'page', entry: [{ messaging: 5 }] },
      { object: 'page', entry: [{ messaging: [null, 'x', { sender: null }] }] },
      { object: 'page', entry: [{ messaging: [{ sender: { id: 5 }, message: { text: 'x' } }] }] },
    ]) {
      expect(provider.ingest(body)).toBe(200)
    }
  })

  it('an attachment type named like an Object.prototype key yields a string mimetype', () => {
    const [ev] = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'm', attachments: [{ type: 'constructor', payload: { url: 'https://x/y' } }] } }))
    expectWellFormedEvent(ev)
  })

  it('seeded random mutations: ingest answers a status and every event is well formed', () => {
    const provider = new MessengerProvider({ accessToken: 'T', verifyToken: 'v', allowUnsignedWebhooks: true })
    const seen: InboundEvent[] = []
    provider.onEvent((e) => { seen.push(e) })
    for (const body of mutations(20260425, samples, 3000)) {
      const status = provider.ingest(body)
      expect([200, 400]).toContain(status)
    }
    expect(seen.length).toBeGreaterThan(100)
    for (const e of seen) expectWellFormedEvent(e)
  })
})

describe('Messenger outbound contract', () => {
  it('advertises the Send API text limit (2000 chars) so ctx.stream() chunks fit', () => {
    const provider = new MessengerProvider({ accessToken: 'T', verifyToken: 'v', allowUnsignedWebhooks: true })
    expect(provider.capabilities.maxTextLength).toBe(2000)
  })

  it("rejects native content addressed to another provider instead of posting it", async () => {
    const provider = new MessengerProvider({ accessToken: 'T', verifyToken: 'v', allowUnsignedWebhooks: true })
    const err = await provider.send('PSID', { kind: 'native', provider: 'telegram', payload: { text: 'x' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect(toOutbound({ kind: 'native', provider: 'messenger', payload: { text: 'ok' } })).toEqual({ text: 'ok' })
  })
})

describe('Messenger config errors', () => {
  it('missing accessToken / verifyToken fail at construction with an actionable message', () => {
    expect(() => new MessengerProvider({ accessToken: undefined as unknown as string, verifyToken: 'v', allowUnsignedWebhooks: true })).toThrow(/MessengerProvider requires `accessToken`/)
    expect(() => new MessengerProvider({ accessToken: 'T', verifyToken: '' , allowUnsignedWebhooks: true })).toThrow(/MessengerProvider requires `verifyToken`/)
  })
})
