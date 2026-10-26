import { describe, it, expect } from 'vitest'
import type { InboundEvent } from '@botmesh/core'
import { UnsupportedContentError } from '@botmesh/core'
import { InstagramProvider } from '../src/InstagramProvider.js'
import { toOutbound } from '../src/toOutbound.js'
import { parseInbound, type IgWebhookBody } from '../src/parseInbound.js'
import { expectWellFormedEvent, mutations } from '../../../test-utils/fuzz.js'

const page = (...messaging: unknown[]): IgWebhookBody => ({ object: 'instagram', entry: [{ id: 'IG', time: 1, messaging: messaging as never }] })
const cfg = { accessToken: 'T', verifyToken: 'v', allowUnsignedWebhooks: true }

describe('Instagram ingest never throws on malformed bodies', () => {
  const samples: IgWebhookBody[] = [
    page(
      { sender: { id: 'U' }, recipient: { id: 'IG' }, timestamp: 5, message: { mid: 'm1', text: 'hi', reply_to: { mid: 'x' } } },
      { sender: { id: 'U' }, recipient: { id: 'IG' }, timestamp: 6, message: { mid: 'm2', attachments: [{ type: 'image', payload: { url: 'https://lookaside.fbsbx.com/a' } }] } },
      { sender: { id: 'U' }, recipient: { id: 'IG' }, timestamp: 7, message: { mid: 'm3', text: 'q', quick_reply: { payload: 'Q' } } },
      { sender: { id: 'U' }, recipient: { id: 'IG' }, timestamp: 8, reaction: { mid: 'm1', action: 'react', reaction: 'love', emoji: '❤' } },
      { sender: { id: 'U' }, recipient: { id: 'IG' }, timestamp: 9, postback: { mid: 'pb', payload: 'P', title: 't' } },
      { sender: { id: 'U' }, recipient: { id: 'IG' }, timestamp: 10, message: { mid: 'm4', attachments: [{ type: 'share', payload: { url: 'https://x/p' } }] } },
    ),
  ]

  it('handles hand-picked hostile shapes', () => {
    const provider = new InstagramProvider(cfg)
    for (const body of [
      { object: 'page', entry: true },
      { object: 'page', entry: [null] },
      { object: 'page', entry: [{ messaging: 0 }] },
      { object: 'page', entry: [{ messaging: [null, 1e300, { sender: { id: [] }, message: { text: 'x' } }] }] },
      { object: 'page', entry: [{ messaging: [{ sender: { id: 'U' }, message: 'not-an-object' }] }] },
    ]) {
      expect(provider.ingest(body)).toBe(200)
    }
  })

  it('an attachment type named like an Object.prototype key is not media', () => {
    const [ev] = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'm', attachments: [{ type: 'constructor', payload: { url: 'https://x/y' } }] } }))
    expectWellFormedEvent(ev)
    expect(ev?.kind === 'message' && ev.message.type).toBe('unknown')
  })

  it('seeded random mutations: ingest answers a status and every event is well formed', () => {
    const provider = new InstagramProvider(cfg)
    const seen: InboundEvent[] = []
    provider.onEvent((e) => { seen.push(e) })
    for (const body of mutations(20260425, samples, 3000)) {
      expect([200, 400]).toContain(provider.ingest(body))
    }
    expect(seen.length).toBeGreaterThan(100)
    for (const e of seen) expectWellFormedEvent(e)
  })
})

describe('Instagram outbound contract', () => {
  it('advertises the Send API text limit (1000) so ctx.stream() chunks fit', () => {
    expect(new InstagramProvider(cfg).capabilities.maxTextLength).toBe(1000)
  })

  it('rejects native content addressed to another provider instead of posting it', async () => {
    const err = await new InstagramProvider(cfg).send('IGSID', { kind: 'native', provider: 'discord', payload: { text: 'x' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect(toOutbound({ kind: 'native', provider: 'instagram', payload: { text: 'ok' } })).toEqual({ text: 'ok' })
  })
})

describe('Instagram config errors', () => {
  it('missing accessToken / verifyToken fail at construction with an actionable message', () => {
    expect(() => new InstagramProvider({ ...cfg, accessToken: undefined as unknown as string })).toThrow(/InstagramProvider requires `accessToken`/)
    expect(() => new InstagramProvider({ ...cfg, verifyToken: '' })).toThrow(/InstagramProvider requires `verifyToken`/)
  })
})
