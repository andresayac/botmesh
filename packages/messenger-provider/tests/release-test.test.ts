/**
 * Defects found by the beta release test of @botmesh/messenger: text dropped from
 * lists and long button messages, broken emoji in cut labels, inbound edits and
 * extra attachments dropped, postbacks without a mid never deduplicated, message
 * tags impossible to send and a page id not encoded into the URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from '@botmesh/core'
import { MessengerProvider, isEditedMessage } from '../src/index.js'
import { toOutboundMessages } from '../src/toOutbound.js'
import { parseInbound } from '../src/parseInbound.js'

afterEach(() => vi.unstubAllGlobals())

const cfg = { accessToken: 'TOK', verifyToken: 'vt', allowUnsignedWebhooks: true, logger: { debug() {}, info() {}, warn() {}, error() {} } }

function captureFetch(): Array<{ url: string; body: Record<string, unknown> }> {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ message_id: `m${calls.length}` }) }
  }))
  return calls
}

const page = (...messaging: unknown[]) => ({ object: 'page', entry: [{ id: 'PAGE', time: 1, messaging }] })

describe('outbound text is never dropped', () => {
  it('a list sends its text before the generic template (the template has no header)', () => {
    const msgs = toOutboundMessages({ kind: 'list', text: 'Elige un pan', buttonText: 'Ver', sections: [{ rows: [{ id: 'b', title: 'Baguette' }] }] })
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({ text: 'Elige un pan' })
    expect(JSON.stringify(msgs[1])).toContain('"template_type":"generic"')
  })

  it('a list without rows is its text once (no empty template)', () => {
    const msgs = toOutboundMessages({ kind: 'list', text: 'Nada', buttonText: 'Ver', sections: [] })
    expect(msgs).toEqual([{ text: 'Nada' }])
  })

  it('buttons whose text exceeds the 640-char button template keep all of it', () => {
    const text = `${'Primera parte. '.repeat(30)}\n\n${'Segunda parte. '.repeat(30)}`
    const msgs = toOutboundMessages({ kind: 'buttons', text, buttons: [{ id: 'a', title: 'A' }] })
    const last = msgs[msgs.length - 1] as { attachment: { payload: { text: string } } }
    expect(last.attachment.payload.text.length).toBeLessThanOrEqual(640)
    const sentText = [...msgs.slice(0, -1).map((m) => (m as { text: string }).text), last.attachment.payload.text].join(' ')
    expect(sentText.replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim())
    for (const m of msgs.slice(0, -1)) expect((m as { text: string }).text.length).toBeLessThanOrEqual(2000)
  })

  it('buttons with an empty button list are sent as plain text', () => {
    expect(toOutboundMessages({ kind: 'buttons', text: 'hola', buttons: [] })).toEqual([{ text: 'hola' }])
  })

  it('send() posts every message of a list in order', async () => {
    const calls = captureFetch()
    const p = new MessengerProvider(cfg)
    const r = await p.send('PSID', { kind: 'list', text: 'Elige', buttonText: 'Ver', sections: [{ rows: [{ id: 'b', title: 'B' }] }] })
    expect(calls.map((c) => Object.keys(c.body['message'] as object)[0])).toEqual(['text', 'attachment'])
    expect(r.ref.id).toBe('m2')
  })
})

describe('labels are cut on grapheme boundaries', () => {
  it('a family emoji is kept whole or dropped whole, never split', () => {
    const fam = '👩‍👩‍👧‍👦'
    const [msg] = toOutboundMessages({ kind: 'buttons', text: 'x', buttons: [{ id: 'f', title: fam.repeat(5) }] })
    const title = (msg as { attachment: { payload: { buttons: Array<{ title: string }> } } }).attachment.payload.buttons[0]!.title
    expect(Array.from(title).length).toBeLessThanOrEqual(20)
    expect(title).toBe(fam.repeat(2))
  })
})

describe('inbound edits, locations, albums and postbacks', () => {
  it('a message_edit webhook is a text message with the original mid, flagged by isEditedMessage', () => {
    const events = parseInbound(page({ sender: { id: 'U' }, recipient: { id: 'PAGE' }, timestamp: 1700000000000, message_edit: { mid: 'm_orig', text: 'corregido', num_edit: 1 } }) as never)
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.kind).toBe('message')
    if (ev.kind !== 'message') return
    expect(ev.message.ref.id).toBe('m_orig')
    expect(ev.message.type).toBe('text')
    expect(ev.message.body).toBe('corregido')
    expect(isEditedMessage(ev.message)).toBe(true)
    const plain = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'x', text: 'hola' } }) as never)[0]!
    expect(plain.kind === 'message' && isEditedMessage(plain.message)).toBe(false)
  })

  it('an edit reaches the bot as a new message (the deduper tells it apart by content)', async () => {
    const p = new MessengerProvider(cfg)
    const bot = new Bot({ provider: p, logger: cfg.logger })
    const bodies: string[] = []
    bot.on('message', (m) => { bodies.push(m.body) })
    await bot.start()
    const original = page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'm1', text: 'hola' } })
    p.ingest(original)
    p.ingest(page({ sender: { id: 'U' }, timestamp: 2, message_edit: { mid: 'm1', text: 'hola editado', num_edit: 1 } }))
    p.ingest(page({ sender: { id: 'U' }, timestamp: 2, message_edit: { mid: 'm1', text: 'hola editado', num_edit: 1 } })) // a Meta retry of the edit is a duplicate
    await vi.waitFor(() => expect(bodies).toEqual(['hola', 'hola editado']))
    await new Promise((r) => setTimeout(r, 50))
    expect(bodies).toEqual(['hola', 'hola editado'])
    await bot.stop()
  })

  it('a location keeps the place name Meta sends on the attachment itself', () => {
    const [ev] = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'm', attachments: [{ type: 'location', title: 'Tienda', url: 'https://l.facebook.com/x', payload: { coordinates: { lat: 4.6, long: -74.1 } } }] } }) as never)
    expect(ev?.kind === 'message' && ev.message.location).toMatchObject({ latitude: 4.6, longitude: -74.1, name: 'Tienda' })
  })

  it('every attachment of a multi-attachment message reaches the bot (one message each, unique ids)', () => {
    const events = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'mA', text: 'fotos', attachments: [
      { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/1.jpg' } },
      { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/2.jpg' } },
      { type: 'video', payload: { url: 'https://video.xx.fbcdn.net/3.mp4' } },
    ] } }) as never)
    const msgs = events.flatMap((e) => (e.kind === 'message' ? [e.message] : []))
    expect(msgs.map((m) => m.ref.id)).toEqual(['mA', 'mA#2', 'mA#3'])
    expect(msgs.map((m) => m.type)).toEqual(['image', 'image', 'video'])
    expect(msgs.map((m) => m.media?.token)).toEqual(['https://scontent.xx.fbcdn.net/1.jpg', 'https://scontent.xx.fbcdn.net/2.jpg', 'https://video.xx.fbcdn.net/3.mp4'])
    expect(msgs.map((m) => m.body)).toEqual(['fotos', '', ''])
  })

  it('a postback without mid gets an id from its timestamp, so a Meta retry is deduplicated', () => {
    const ev = { sender: { id: 'U' }, timestamp: 1700000000123, postback: { payload: 'START', title: 'Empezar' } }
    const [a] = parseInbound(page(ev) as never)
    const [b] = parseInbound(page(ev) as never)
    expect(a?.kind === 'interaction' && a.interaction.interactionId).toBe('postback:1700000000123')
    expect(b?.kind === 'interaction' && b.interaction.interactionId).toBe('postback:1700000000123')
  })
})

describe('message tags and page id', () => {
  it('platformData.tag sends a MESSAGE_TAG message (outside the 24h window)', async () => {
    const calls = captureFetch()
    const p = new MessengerProvider(cfg)
    await p.send('PSID', { kind: 'text', text: 'Tu pedido salió' }, { platformData: { tag: 'POST_PURCHASE_UPDATE' } })
    expect(calls[0]!.body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE' })
    await p.send('PSID', { kind: 'text', text: 'Aviso' }, { platformData: { messaging_type: 'UPDATE', notification_type: 'SILENT_PUSH' } })
    expect(calls[1]!.body).toMatchObject({ messaging_type: 'UPDATE', notification_type: 'SILENT_PUSH' })
    expect(calls[1]!.body).not.toHaveProperty('tag')
  })

  it('unknown platformData keys are not posted; a non-string tag is rejected before any call', async () => {
    const calls = captureFetch()
    const p = new MessengerProvider(cfg)
    await p.send('PSID', { kind: 'text', text: 'x' }, { platformData: { recipient: { id: 'OTHER' }, access_token: 'evil' } })
    expect(calls[0]!.body).toEqual({ recipient: { id: 'PSID' }, messaging_type: 'RESPONSE', message: { text: 'x' } })
    await expect(p.send('PSID', { kind: 'text', text: 'x' }, { platformData: { tag: 42 } })).rejects.toThrow(/platformData\.tag/)
    expect(calls).toHaveLength(1)
  })

  it('the page id is encoded into the Send API path', async () => {
    const calls = captureFetch()
    await new MessengerProvider({ ...cfg, pageId: '123/../../evil?x=' }).send('PSID', { kind: 'text', text: 'x' })
    expect(calls[0]!.url).toContain('/123%2F..%2F..%2Fevil%3Fx%3D/messages')
  })
})

describe('text past the 2000-char Send API limit is split, never rejected by Graph', () => {
  const long = 'Una frase de prueba. '.repeat(150) // 3150 chars
  it('a card, a list text and button-less buttons over 2000 chars become several text messages', () => {
    for (const msgs of [
      toOutboundMessages({ kind: 'card', title: 'T', body: long }),
      toOutboundMessages({ kind: 'card', title: 'T', body: long, buttons: [{ id: 'a', title: 'A' }] }),
      toOutboundMessages({ kind: 'card', title: '', body: long, buttons: [{ id: 'a', title: 'A' }] }),
      toOutboundMessages({ kind: 'list', text: long, buttonText: 'Ver', sections: [{ rows: [{ id: 'b', title: 'B' }] }] }),
      toOutboundMessages({ kind: 'buttons', text: long, buttons: [] }),
    ]) {
      expect(msgs.length).toBeGreaterThan(1)
      for (const m of msgs) {
        if ('text' in m) expect((m['text'] as string).length).toBeLessThanOrEqual(2000)
        const t = (m as { attachment?: { payload?: { text?: string } } }).attachment?.payload?.text
        if (t !== undefined) { expect(t.length).toBeGreaterThan(0); expect(t.length).toBeLessThanOrEqual(640) }
      }
    }
  })
})

describe('shared links', () => {
  it('a fallback attachment (a shared link) is a text message with its title and URL, never a downloadable document', () => {
    const [ev] = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'mL', attachments: [{ type: 'fallback', payload: { url: 'https://example.com/a', title: 'Un artículo' } }] } }) as never)
    expect(ev?.kind === 'message' && ev.message).toMatchObject({ type: 'text', body: 'Un artículo\nhttps://example.com/a' })
    expect(ev?.kind === 'message' && ev.message.media).toBeUndefined()
    const [withText] = parseInbound(page({ sender: { id: 'U' }, timestamp: 1, message: { mid: 'mT', text: 'mira https://example.com/a', attachments: [{ type: 'fallback', payload: { url: 'https://example.com/a' } }] } }) as never)
    expect(withText?.kind === 'message' && withText.message).toMatchObject({ type: 'text', body: 'mira https://example.com/a' })
  })
})

describe('seeded fuzzing of the new inbound shapes', () => {
  it('random edits, attachment lists and postbacks never throw and yield well-formed events', () => {
    let seed = 0x5eed
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const junk = (): unknown => pick([undefined, null, 0, -1, NaN, '', 'x', '🙂‍↔️', [], {}, { url: 'https://scontent.xx.fbcdn.net/a' }, Object.create(null), 'constructor', '__proto__', 1e309])
    const p = new MessengerProvider(cfg)
    for (let i = 0; i < 3000; i++) {
      const ev: Record<string, unknown> = { sender: pick([{ id: 'U' }, { id: junk() }, junk()]), timestamp: pick([1, junk()]) }
      const which = pick(['edit', 'msg', 'postback'])
      if (which === 'edit') ev['message_edit'] = pick([{ mid: junk(), text: junk(), num_edit: junk() }, junk()])
      if (which === 'msg') ev['message'] = { mid: junk(), text: junk(), attachments: pick([junk(), Array.from({ length: Math.floor(rnd() * 5) }, () => pick([{ type: pick(['image', 'fallback', 'location', 'file', 'toString', junk()]), title: junk(), url: junk(), payload: pick([junk(), { url: junk(), title: junk(), coordinates: { lat: junk(), long: junk() } }]) }, junk()]))]) }
      if (which === 'postback') ev['postback'] = pick([{ mid: junk(), payload: junk() }, junk()])
      const body = page(ev)
      expect([200, 400]).toContain(p.ingest(body))
      for (const e of parseInbound(body as never)) {
        if (e.kind === 'message') {
          expect(typeof e.message.ref.id).toBe('string')
          expect(typeof e.message.body).toBe('string')
          expect(typeof e.message.chatId).toBe('string')
          if (e.message.media) expect(typeof e.message.media.mimetype).toBe('string')
        }
        if (e.kind === 'interaction') expect(typeof e.interaction.interactionId).toBe('string')
      }
    }
  })
})
