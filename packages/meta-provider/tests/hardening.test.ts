/**
 * Release-readiness hardening: config mistakes fail fast with actionable
 * messages, a Graph request that never answers cannot hang a send forever, and
 * malformed webhook fields never reach the bot with the wrong type.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProviderError, UnsupportedContentError, type InboundEvent } from '@botmesh/core'
import { CloudAPIProvider } from '../src/CloudAPIProvider.js'
import { SessionWindowReopenedError } from '../src/sessionWindow.js'
import { parseInbound } from '../src/parseInbound.js'
import { toOutbound } from '../src/toOutbound.js'

const baseCfg = { accessToken: 'TOK', phoneNumberId: 'PNID', verifyToken: 'vt', allowUnsignedWebhooks: true }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('CloudAPIProvider config validation', () => {
  it.each([
    ['accessToken', { accessToken: undefined }],
    ['accessToken', { accessToken: '  ' }],
    ['phoneNumberId', { phoneNumberId: undefined }],
    ['phoneNumberId', { phoneNumberId: '' }],
    ['verifyToken', { verifyToken: undefined }],
  ])('names the missing %s', (field, patch) => {
    expect(() => new CloudAPIProvider({ ...baseCfg, ...patch } as never)).toThrow(new RegExp(`CloudAPIProvider.*\`${field}\``))
  })

  it.each([0, -1, Number.NaN, Infinity])('rejects requestTimeoutMs %s', (requestTimeoutMs) => {
    expect(() => new CloudAPIProvider({ ...baseCfg, requestTimeoutMs })).toThrow(/requestTimeoutMs/)
  })

  it('never echoes the access token in a config error', () => {
    try {
      new CloudAPIProvider({ ...baseCfg, phoneNumberId: '', accessToken: 'EAAG-super-secret' })
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('EAAG-super-secret')
    }
  })
})

describe('Graph request timeout', () => {
  /** A fetch that never answers, but honours its abort signal like the real one. */
  function hangingFetch() {
    return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
  }

  it('rejects a send with a typed ProviderError when Graph never answers', async () => {
    const fetch = hangingFetch()
    vi.stubGlobal('fetch', fetch)
    const p = new CloudAPIProvider({ ...baseCfg, requestTimeoutMs: 50 })
    const err = await p.send('573001', { kind: 'text', text: 'hola' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/timed out after 50ms/)
    expect((err as Error).message).not.toContain('TOK')
  })

  it('applies a default timeout to every Graph call', async () => {
    const fetch = hangingFetch()
    vi.stubGlobal('fetch', fetch)
    const p = new CloudAPIProvider(baseCfg)
    await p.start()
    void p.markRead([{ id: 'wamid.1', chatId: '573001' }]).catch(() => {})
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('Graph request timer hygiene', () => {
  const timeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length

  it('leaves no timer behind once a request settles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ messages: [{ id: 'wamid.X' }] }) })))
    const p = new CloudAPIProvider({ ...baseCfg, requestTimeoutMs: 60_000 })
    const before = timeouts()
    for (let i = 0; i < 20; i++) await p.send('573001', { kind: 'text', text: `m${i}` })
    expect(timeouts()).toBe(before)
  })

  it('times out a response whose body never finishes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      }),
    })))
    const p = new CloudAPIProvider({ ...baseCfg, requestTimeoutMs: 50 })
    await expect(p.send('573001', { kind: 'text', text: 'x' })).rejects.toThrow(/timed out after 50ms/)
  })
})

describe('downloadMedia', () => {
  it('encodes the media id into the Graph path', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetch)
    const p = new CloudAPIProvider(baseCfg)
    await p.downloadMedia({ kind: 'image', token: '../me?fields=id#x' }).catch(() => {})
    expect(fetch.mock.calls[0]![0]).toBe('https://graph.facebook.com/v26.0/..%2Fme%3Ffields%3Did%23x')
  })
})

/* --- Inbound typing ------------------------------------------------------- */

const wrap = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '573001112233', id: 'wamid.1', ...message }] } }] }],
})

const one = (message: Record<string, unknown>): InboundEvent => {
  const events = parseInbound(wrap(message) as never)
  expect(events).toHaveLength(1)
  return events[0]!
}

describe('parseInbound field typing', () => {
  it('never emits a non-string body', () => {
    for (const body of [42, null, { x: 1 }, ['a'], true]) {
      const e = one({ type: 'text', timestamp: '1700000000', text: { body } })
      expect(e.kind === 'message' && e.message.body).toBe('')
    }
    const media = one({ type: 'image', image: { id: 'M1', caption: { evil: 1 }, mime_type: 7, filename: ['x'] } })
    expect(media.kind).toBe('message')
    if (media.kind !== 'message') return
    expect(media.message.body).toBe('')
    expect(media.message.media).toEqual({ kind: 'image', token: 'M1', mimetype: undefined, filename: undefined })
  })

  it('drops a non-string media id instead of passing it as the token', () => {
    const e = one({ type: 'document', document: { id: 12345 } })
    expect(e.kind === 'message' && e.message.media?.token).toBeUndefined()
  })

  it('keeps timestamps finite: an invalid one becomes the receive time (epoch ms)', () => {
    const before = Date.now()
    for (const timestamp of ['NaN', 'abc', { x: 1 }, -5, '1e400']) {
      const e = one({ type: 'text', timestamp, text: { body: 'hi' } })
      expect(e.kind === 'message' && e.message.timestamp).toBeGreaterThanOrEqual(before)
    }
    const click = one({ type: 'interactive', timestamp: 'later', interactive: { type: 'button_reply', button_reply: { id: 'a' } } })
    expect(click.kind === 'interaction' && click.interaction.timestamp).toBeGreaterThanOrEqual(before)
    const status = parseInbound({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.9', status: 'read', recipient_id: '573001112233', timestamp: 'x' }] } }] }],
    })
    expect(status[0]?.kind === 'status' && status[0].status.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('reads a reaction emoji only when it is a string', () => {
    const e = one({ type: 'reaction', reaction: { message_id: 'wamid.0', emoji: { not: 'an emoji' } } })
    expect(e.kind === 'reaction' && e.reaction.emoji).toBe('')
  })

  it('reads interactive reply ids only when they are strings', () => {
    const e = one({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 99 } } })
    expect(e.kind === 'interaction' && e.interaction.data).toBe('')
  })
})

/* --- Outbound mapping ----------------------------------------------------- */

const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)

describe('toOutbound limits', () => {
  it('cuts button titles on characters, never inside an emoji', () => {
    const title = `${'a'.repeat(19)}😀😀`
    const out = toOutbound({ kind: 'buttons', text: 't', buttons: [{ id: 'x', title }] }) as {
      interactive: { action: { buttons: Array<{ reply: { title: string } }> } }
    }
    const cut = out.interactive.action.buttons[0]!.reply.title
    expect(hasLoneSurrogate(cut)).toBe(false)
    expect(Array.from(cut)).toHaveLength(20)
  })

  it('cuts list labels on characters and caps descriptions and section titles', () => {
    const out = toOutbound({
      kind: 'list',
      text: 't',
      buttonText: `${'b'.repeat(19)}🍰🍰`,
      sections: [{ title: `${'s'.repeat(23)}🧁🧁`, rows: [{ id: 'r', title: `${'r'.repeat(23)}🎂🎂`, description: 'd'.repeat(100) }] }],
    }) as { interactive: { action: { button: string; sections: Array<{ title: string; rows: Array<{ title: string; description: string }> }> } } }
    const { button, sections } = out.interactive.action
    for (const s of [button, sections[0]!.title, sections[0]!.rows[0]!.title]) expect(hasLoneSurrogate(s)).toBe(false)
    expect(Array.from(button)).toHaveLength(20)
    expect(Array.from(sections[0]!.title)).toHaveLength(24)
    expect(Array.from(sections[0]!.rows[0]!.title)).toHaveLength(24)
    expect(sections[0]!.rows[0]!.description).toHaveLength(72)
  })

  it('rejects more than 3 reply buttons instead of silently dropping options', () => {
    const buttons = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` }))
    expect(() => toOutbound({ kind: 'buttons', text: 't', buttons })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'buttons', text: 't', buttons })).toThrow(/at most 3.*got 4.*list/)
  })

  it('reports the real content kind when a media source is missing', () => {
    const err = (() => { try { toOutbound({ kind: 'video', media: '' as never }) } catch (e) { return e } })()
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as UnsupportedContentError).kind).toBe('video')
  })

  it('explains polls in English', () => {
    expect(() => toOutbound({ kind: 'poll', question: 'q', options: ['a', 'b'] })).toThrow(/does not support polls/)
  })
})

describe('no personal data in error messages', () => {
  it('SessionWindowReopenedError keeps the phone number out of its message (it is on .chatId)', () => {
    const err = new SessionWindowReopenedError('573001112233', { kind: 'template', name: 'reopen', language: 'en' }, true)
    expect(err.chatId).toBe('573001112233')
    expect(err.message).not.toContain('573001112233')
    expect(err.message).toMatch(/reopened with template "reopen"/)
  })
})
