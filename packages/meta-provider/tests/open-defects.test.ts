/** Low-severity defects left open by the alpha exit review (docs/release-readiness.md). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnsupportedContentError } from '@botmesh/core'
import { CloudAPIProvider } from '../src/CloudAPIProvider.js'
import { parseInbound, type GraphWebhookBody } from '../src/parseInbound.js'
import { toOutbound } from '../src/toOutbound.js'

const wrap = (value: unknown): GraphWebhookBody => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'pnid', changes: [{ field: 'messages', value: value as never }] }],
})
const baseCfg = { accessToken: 'TOK', phoneNumberId: 'PNID', verifyToken: 'vt', allowUnsignedWebhooks: true }
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals() })

describe('inbound: an unknown interactive type is not a button press', () => {
  it('emits an unknown message (raw kept) instead of a button interaction with empty data', () => {
    const events = parseInbound(wrap({
      messages: [{ from: '573001', id: 'wamid.9', timestamp: '1', type: 'interactive', interactive: { type: 'call_permission_reply', call_permission_reply: { response: 'accept' } } }],
    }))
    expect(events).toHaveLength(1)
    const e = events[0]!
    expect(e.kind).toBe('message')
    if (e.kind === 'message') {
      expect(e.message.type).toBe('unknown')
      expect(e.message.ref.native).toMatchObject({ interactive: { type: 'call_permission_reply' } })
    }
  })
})

describe('inbound: status errors are checked', () => {
  it('keeps a numeric code and a string title, drops other shapes', () => {
    const status = (errors: unknown) => {
      const [e] = parseInbound(wrap({ statuses: [{ id: 'wamid.1', status: 'failed', timestamp: '1', recipient_id: '573001', errors }] }))
      return e?.kind === 'status' ? e.status.error : 'no status'
    }
    expect(status([{ code: 131047, title: 'Re-engagement message' }])).toEqual({ code: 131047, message: 'Re-engagement message' })
    expect(status([{ code: { nested: true }, title: ['x'] }])).toEqual({})
    expect(status([{ code: '131026', message: 'Message undeliverable' }])).toEqual({ code: 131026, message: 'Message undeliverable' })
    expect(status(['oops'])).toBeUndefined()
    const long = status([{ code: 1, title: 'x'.repeat(5000) }]) as { message?: string }
    expect(long.message!.length).toBeLessThanOrEqual(1000)
  })
})

describe('outbound: interactive limits are enforced locally', () => {
  it('rejects buttons with no button', () => {
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [] })).toThrow(UnsupportedContentError)
  })
  it('rejects reply buttons whose titles are equal (after the 20-character cut) or whose ids repeat', () => {
    const t = 'Confirmar pedido de hoy'
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: `${t} A` }, { id: 'b', title: `${t} B` }] })).toThrow(/unique/i)
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'Si' }, { id: 'a', title: 'No' }] })).toThrow(/id/i)
  })
  it('rejects a list with more than 10 rows, an empty list, or duplicate row ids', () => {
    const rows = (n: number, p = 'r') => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, title: `Row ${p}${i}` }))
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ title: 'A', rows: rows(6) }, { title: 'B', rows: rows(5, 'b') }] })).toThrow(/10 rows/)
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ title: 'A', rows: [] }] })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [] })).toThrow(UnsupportedContentError)
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ rows: [{ id: 'r', title: 'a' }, { id: 'r', title: 'b' }] }] })).toThrow(/id/i)
    expect(() => toOutbound({ kind: 'list', text: 'x', buttonText: 'Ver', sections: [{ title: 'A', rows: rows(10) }] })).not.toThrow()
  })
})

describe('outbound: labels are cut on grapheme boundaries', () => {
  it('never splits an emoji ZWJ sequence or a flag (kept whole when it fits, dropped whole when not)', () => {
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) // 5 code points
    const flag = String.fromCodePoint(0x1f1e8, 0x1f1f4) // 2 code points
    const titles = (buttons: Array<{ id: string; title: string }>) => (toOutbound({ kind: 'buttons', text: 'x', buttons }) as {
      interactive: { action: { buttons: Array<{ reply: { title: string } }> } }
    }).interactive.action.buttons.map((b) => b.reply.title)
    expect(titles([{ id: 'a', title: `${'a'.repeat(19)}${family}zzz` }, { id: 'b', title: `${'b'.repeat(19)}${flag}zz` }]))
      .toEqual(['a'.repeat(19), 'b'.repeat(19)])
    expect(titles([{ id: 'a', title: `${'a'.repeat(10)}${family}${'z'.repeat(10)}` }, { id: 'b', title: `${'b'.repeat(18)}${flag}zz` }]))
      .toEqual([`${'a'.repeat(10)}${family}zzzzz`, `${'b'.repeat(18)}${flag}`])
  })
})

describe('config', () => {
  it('accepts a numeric phoneNumberId (a safe integer) and uses it as a string', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json({ messages: [{ id: 'wamid.X' }] }))
    vi.stubGlobal('fetch', fetch)
    const p = new CloudAPIProvider({ ...baseCfg, phoneNumberId: 106540352242922 as unknown as string })
    await p.send('573001', { kind: 'text', text: 'hola' })
    expect(String(fetch.mock.calls[0]![0])).toContain('/106540352242922/messages')
  })

  it('still rejects a phoneNumberId that is not a safe positive integer', () => {
    expect(() => new CloudAPIProvider({ ...baseCfg, phoneNumberId: 1.5 as unknown as string })).toThrow(/phoneNumberId/)
    expect(() => new CloudAPIProvider({ ...baseCfg, phoneNumberId: 2 ** 60 as unknown as string })).toThrow(/phoneNumberId/)
  })

  it('media uploads get their own, longer timeout (uploadTimeoutMs)', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      seen.push(String(url))
      if (String(url).endsWith('/media')) {
        // Upload slower than requestTimeoutMs but within uploadTimeoutMs.
        const t = setTimeout(() => resolve(json({ id: 'MEDIA' })), 120)
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal!.reason) }, { once: true })
        return
      }
      resolve(json({ messages: [{ id: 'wamid.X' }] }))
    })))
    const p = new CloudAPIProvider({ ...baseCfg, requestTimeoutMs: 50, uploadTimeoutMs: 2_000 })
    await expect(p.send('573001', { kind: 'image', media: Buffer.from('png') })).resolves.toBeTruthy()
    expect(seen.some((u) => u.endsWith('/media'))).toBe(true)
    expect(() => new CloudAPIProvider({ ...baseCfg, uploadTimeoutMs: 0 })).toThrow(/uploadTimeoutMs/)
  })
})
