/**
 * Outbound content edge cases: what a user can hand `ctx.*` that used to fail
 * late with an opaque error, or to send something broken.
 */
import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { PayloadTooLargeError, UnsupportedContentError } from '@botmesh/core'
import { toOutbound } from '../src/toOutbound.js'

const PUBLIC = async () => ['93.184.216.34']

describe('polls', () => {
  it('sends a valid poll unchanged', async () => {
    await expect(toOutbound({ kind: 'poll', question: 'Pizza or sushi?', options: ['Pizza', 'Sushi'], multiSelect: true }))
      .resolves.toEqual({ poll: { name: 'Pizza or sushi?', values: ['Pizza', 'Sushi'], selectableCount: 2 } })
  })

  const bad: Array<[string, { question: string; options: string[] }]> = [
    ['fewer than two options', { question: 'q', options: ['only'] }],
    ['more than twelve options', { question: 'q', options: Array.from({ length: 13 }, (_, i) => `o${i}`) }],
    ['duplicate options (their votes would be indistinguishable)', { question: 'q', options: ['Yes', 'Yes'] }],
    ['an empty option', { question: 'q', options: ['Yes', '  '] }],
    ['an empty question', { question: ' ', options: ['Yes', 'No'] }],
  ]
  for (const [label, poll] of bad) {
    it(`rejects ${label} with UnsupportedContentError`, async () => {
      const err = await toOutbound({ kind: 'poll', ...poll }).then(() => null, (e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toMatch(/poll/i)
    })
  }
})

describe('reactions', () => {
  it('rebuilds the target key when the ref lost its native message (e.g. read back from a store)', async () => {
    const out = await toOutbound({ kind: 'reaction', emoji: '👍', target: { id: 'ABC', chatId: '573001112233@s.whatsapp.net' } })
    expect(out).toEqual({ react: { text: '👍', key: { remoteJid: '573001112233@s.whatsapp.net', id: 'ABC', fromMe: false } } })
  })

  it('uses the native key when present', async () => {
    const key = { remoteJid: 'g@g.us', id: 'X', fromMe: false, participant: 'p@s.whatsapp.net' }
    const out = await toOutbound({ kind: 'reaction', emoji: '', target: { id: 'X', chatId: 'g@g.us', native: { key } } })
    expect(out).toEqual({ react: { text: '', key } })
  })
})

describe('contacts', () => {
  it('escapes the display name so it cannot inject vCard fields', async () => {
    const out = await toOutbound({ kind: 'contact', phone: '+57 300 123\r\n4567', displayName: 'Eve\nTEL:+1999;x,y\\' }) as {
      contacts: { contacts: Array<{ vcard: string }> }
    }
    const vcard = out.contacts.contacts[0]!.vcard
    const lines = vcard.split('\n')
    expect(lines).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Eve\\nTEL:+1999\\;x\\,y\\\\',
      'TEL;type=CELL;type=VOICE;waid=573001234567:+57 300 123 4567',
      'END:VCARD',
    ])
  })
})

describe('voice notes and stickers from remote or streamed media', () => {
  it('downloads a voice note URL through the secure fetcher', async () => {
    const fetch = vi.fn(async () => new Response(Buffer.from('not really audio'), { status: 200 }))
    // ffmpeg rejects the bytes, but only after the URL was fetched safely: the error is a ProviderError subclass.
    const err = await toOutbound({ kind: 'voice', media: 'https://cdn.example/tts.mp3' }, { resolver: PUBLIC, fetch }).then(() => null, (e: unknown) => e)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(err).toBeInstanceOf(UnsupportedContentError)
  }, 30_000)

  it('refuses a voice note URL on a private host', async () => {
    const fetch = vi.fn(async () => new Response('x'))
    const err = await toOutbound({ kind: 'voice', media: { url: 'http://127.0.0.1/a.ogg' } }, { fetch }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds a sticker from a streamed PNG', async () => {
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const out = await toOutbound({ kind: 'sticker', media: { stream: Readable.from([png]) } }) as { sticker: Buffer }
    expect(Buffer.isBuffer(out.sticker)).toBe(true)
    expect(out.sticker.subarray(8, 12).toString()).toBe('WEBP')
  })

  it('caps a streamed source at remoteMedia.maxBytes', async () => {
    const err = await toOutbound({ kind: 'sticker', media: { stream: Readable.from([Buffer.alloc(64)]) } }, { maxBytes: 16 }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(PayloadTooLargeError)
  })
})

describe('invalid media sources', () => {
  it('reports a missing local file clearly instead of handing Baileys a bogus URL', async () => {
    const err = await toOutbound({ kind: 'image', media: './definitely-missing-file.png' }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as Error).message).toMatch(/not found|http/i)
  })

  it('rejects an unsupported source shape with UnsupportedContentError', async () => {
    const err = await toOutbound({ kind: 'image', media: { native: 42 } }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
  })
})
