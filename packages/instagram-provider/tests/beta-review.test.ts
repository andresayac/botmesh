/** Defects found by the beta release review (config, captions, quick replies, inbound attachments, stop). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot, UnsupportedContentError, type LoggerLike } from '@botmesh/core'
import { InstagramProvider } from '../src/InstagramProvider.js'
import { toOutbound } from '../src/toOutbound.js'
import { parseInbound } from '../src/parseInbound.js'

const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } } as unknown as LoggerLike
const cfg = { accessToken: 'TOK', verifyToken: 'vt', allowUnsignedWebhooks: true, logger: silent }

function graphFetch(fail?: (body: Record<string, unknown>) => boolean) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(url), body })
    if (fail?.(body)) return new Response(JSON.stringify({ error: { code: 2, message: 'Service temporarily unavailable' } }), { status: 500, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ recipient_id: 'U', message_id: `mid.${calls.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals() })

describe('configuration', () => {
  it('an explicit undefined apiVersion/graphUrl keeps the defaults', async () => {
    const calls = graphFetch()
    await new InstagramProvider({ ...cfg, apiVersion: undefined, graphUrl: undefined }).send('U', { kind: 'text', text: 'x' })
    expect(calls[0]!.url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/me\/messages$/)
  })

  it('rejects a graphUrl that is not an http(s) URL and a malformed apiVersion at construction', () => {
    expect(() => new InstagramProvider({ ...cfg, graphUrl: 'graph.facebook.com' })).toThrow(/graphUrl/)
    expect(() => new InstagramProvider({ ...cfg, graphUrl: 'ftp://x' })).toThrow(/graphUrl/)
    expect(() => new InstagramProvider({ ...cfg, apiVersion: '26.0' })).toThrow(/apiVersion.*v26\.0/)
    expect(() => new InstagramProvider({ ...cfg, apiVersion: 'v26.0/../x' })).toThrow(/apiVersion/)
    expect(() => new InstagramProvider({ ...cfg, graphUrl: 'http://127.0.0.1:9999/', apiVersion: 'v25.0' })).not.toThrow()
  })

  it('rejects a whitespace-only verifyToken or appSecret', () => {
    expect(() => new InstagramProvider({ ...cfg, verifyToken: '   ' })).toThrow(/verifyToken/)
    expect(() => new InstagramProvider({ accessToken: 'T', verifyToken: 'v', appSecret: '  ' })).toThrow(/appSecret/)
  })
})

describe('captions', () => {
  it('sends the caption as a text message right after the attachment', async () => {
    const calls = graphFetch()
    const p = new InstagramProvider(cfg)
    const res = await p.send('U', { kind: 'image', media: 'https://cdn.example.com/a.jpg', caption: 'Nuestro pan 🥖' })
    expect(calls.map((c) => c.body.message)).toEqual([
      { attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg', is_reusable: true } } },
      { text: 'Nuestro pan 🥖' },
    ])
    expect(res.ref.id).toBe('mid.1')
  })

  it('a caption longer than 1000 UTF-8 bytes goes out in several text messages', async () => {
    const calls = graphFetch()
    const caption = 'ñ'.repeat(700) // 1400 bytes
    await new InstagramProvider(cfg).send('U', { kind: 'document', media: { url: 'https://cdn.example.com/a.pdf' }, caption })
    const texts = calls.slice(1).map((c) => (c.body.message as { text: string }).text)
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.every((t) => Buffer.byteLength(t) <= 1000)).toBe(true)
    expect(texts.join('')).toBe(caption)
  })

  it('a card image goes out before the card text (it was dropped)', async () => {
    const calls = graphFetch()
    const res = await new InstagramProvider(cfg).send('U', { kind: 'card', title: 'Croissant', body: '2,50 €', imageUrl: 'https://cdn.example.com/c.jpg', buttons: [{ id: 'buy', title: 'Comprar' }] })
    expect(calls.map((c) => c.body.message)).toEqual([
      { attachment: { type: 'image', payload: { url: 'https://cdn.example.com/c.jpg', is_reusable: true } } },
      { text: 'Croissant\n2,50 €', quick_replies: [{ content_type: 'text', title: 'Comprar', payload: 'buy' }] },
    ])
    expect(res.ref.id).toBe('mid.2')
  })

  it('a failed caption does not fail (and so never re-sends) the delivered attachment', async () => {
    graphFetch((body) => typeof (body.message as { text?: unknown } | undefined)?.text === 'string')
    const warn = vi.fn()
    const p = new InstagramProvider({ ...cfg, logger: { ...silent, warn } as unknown as LoggerLike })
    const res = await p.send('U', { kind: 'video', media: 'https://cdn.example.com/v.mp4', caption: 'secret caption' })
    expect(res.ref.id).toBe('mid.1')
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret caption')
  })
})

describe('quick replies', () => {
  const b = (id: string, title: string) => ({ id, title })
  it('needs a text', () => {
    expect(() => toOutbound({ kind: 'buttons', text: '', buttons: [b('a', 'A')] })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'buttons', text: '   ', buttons: [b('a', 'A')] })).toThrow(/text/)
    expect(() => toOutbound({ kind: 'card', title: '', buttons: [b('a', 'A')] })).toThrow(UnsupportedContentError)
  })
  it('no buttons → plain text, never an empty quick_replies array', () => {
    expect(toOutbound({ kind: 'buttons', text: 'hola', buttons: [] })).toEqual({ text: 'hola' })
  })
  it('titles are cut on grapheme boundaries (an emoji sequence is never split)', () => {
    const family = '\u{1F469}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    const out = toOutbound({ kind: 'buttons', text: 'x', buttons: [b('a', `${family.repeat(3)}abcdefghijklmnopqrstu`)] }) as { quick_replies: Array<{ title: string }> }
    const title = out.quick_replies[0]!.title
    expect(title.startsWith(family.repeat(3))).toBe(true)
    expect([...new Intl.Segmenter().segment(title)].length).toBe(20)
    const whole = toOutbound({ kind: 'buttons', text: 'x', buttons: [b('a', `${'a'.repeat(19)}${family}`)] }) as { quick_replies: Array<{ title: string }> }
    expect(whole.quick_replies[0]!.title).toBe(`${'a'.repeat(19)}${family}`)
  })
  it('rejects duplicate ids, duplicate titles after the cut, an empty title and payloads over 1000 characters', () => {
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [b('a', 'A'), b('a', 'B')] })).toThrow(/duplicate/i)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [b('a', 'x'.repeat(25) + '1'), b('b', 'x'.repeat(25) + '2')] })).toThrow(/duplicate/i)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [b('a', '')] })).toThrow(/title/)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [b('a'.repeat(1001), 'A')] })).toThrow(/1000/)
  })
})

describe('media URLs', () => {
  it('rejects a { url } that is not http(s)', () => {
    expect(() => toOutbound({ kind: 'image', media: { url: 'file:///etc/passwd' } })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'image', media: { url: '' } })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'image', media: { native: { url: 'javascript:alert(1)' } } })).toThrow(UnsupportedContentError)
  })
})

describe('inbound', () => {
  const body = (message: Record<string, unknown>, sender = 'U') => ({ object: 'instagram', entry: [{ messaging: [{ sender: { id: sender }, recipient: { id: 'P' }, timestamp: 1_700_000_000_000, message }] }] })

  it('every attachment of a multi-photo message reaches the bot, with stable distinct ids', () => {
    const events = parseInbound(body({ mid: 'm1', attachments: [
      { type: 'image', payload: { url: 'https://cdn.fbsbx.com/1' } },
      { type: 'video', payload: { url: 'https://cdn.fbsbx.com/2' } },
      { type: 'image', payload: { url: 'https://cdn.fbsbx.com/3' } },
    ] }))
    const msgs = events.map((e) => (e.kind === 'message' ? e.message : null))
    expect(msgs.map((m) => m?.ref.id)).toEqual(['m1', 'm1#2', 'm1#3'])
    expect(msgs.map((m) => m?.type)).toEqual(['image', 'video', 'image'])
    expect(msgs.map((m) => m?.media?.token)).toEqual(['https://cdn.fbsbx.com/1', 'https://cdn.fbsbx.com/2', 'https://cdn.fbsbx.com/3'])
    expect(parseInbound(body({ mid: 'm1', attachments: [{ type: 'image', payload: { url: 'https://cdn.fbsbx.com/1' } }, { type: 'image', payload: { url: 'https://cdn.fbsbx.com/3' } }] })).map((e) => e.kind === 'message' && e.message.ref.id)).toEqual(['m1', 'm1#2'])
  })

  it('without a mid nor a timestamp, extra attachments get no shared id', () => {
    const ev = { object: 'instagram', entry: [{ messaging: [{ sender: { id: 'U' }, message: { attachments: [{ type: 'image', payload: { url: 'https://cdn.fbsbx.com/1' } }, { type: 'image', payload: { url: 'https://cdn.fbsbx.com/2' } }] } }] }] }
    expect(parseInbound(ev).map((e) => e.kind === 'message' && e.message.ref.id)).toEqual(['', ''])
  })

  it('caps the attachments read from one message', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ type: 'image', payload: { url: `https://cdn.fbsbx.com/${i}` } }))
    expect(parseInbound(body({ mid: 'm1', attachments: many })).length).toBeLessThanOrEqual(20)
  })

  it('keeps the user text when the attachment is a share or an unknown type', () => {
    const share = parseInbound(body({ mid: 'm2', text: 'mira esto', attachments: [{ type: 'share', payload: { url: 'https://instagram.com/p/1' } }] }))
    expect(share[0]!.kind === 'message' && share[0]!.message.body).toBe('mira esto')
    const reel = parseInbound(body({ mid: 'm3', text: 'jaja', attachments: [{ type: 'ig_reel', payload: { url: 'https://x/r', title: 'reel' } }] }))
    expect(reel[0]!.kind === 'message' && reel[0]!.message.body).toBe('jaja')
  })

  it('a message whose sender is the configured selfId is fromMe (never answered)', () => {
    const p = new InstagramProvider({ ...cfg, selfId: 'P' })
    const seen: boolean[] = []
    p.onEvent((e) => { if (e.kind === 'message') seen.push(e.message.fromMe) })
    p.ingest(body({ mid: 'm4', text: 'eco' }, 'P'))
    p.ingest(body({ mid: 'm5', text: 'user' }, 'U'))
    expect(seen).toEqual([true, false])
  })
})

describe('stop', () => {
  it('ingest answers 503 while stopped (Meta redelivers) and 200 again after start', async () => {
    const p = new InstagramProvider(cfg)
    const bot = new Bot({ provider: p, logger: silent })
    const seen: string[] = []
    bot.onMessage((ctx) => { seen.push(ctx.body) })
    const hook = (t: string, id: string) => p.ingest({ object: 'instagram', entry: [{ messaging: [{ sender: { id: 'U' }, timestamp: Date.now(), message: { mid: id, text: t } }] }] })
    await bot.start()
    expect(hook('a', 'x1')).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['a']))
    await bot.stop()
    expect(hook('b', 'x2')).toBe(503)
    await bot.start()
    expect(hook('c', 'x3')).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['a', 'c']))
    await bot.stop()
  })
})
