/**
 * toOutbound — map a transport-neutral {@link OutboundContent} to a Baileys
 * `AnyMessageContent`. WhatsApp has no reliable native buttons/lists, so those
 * degrade to numbered text; Cloud-API-only kinds (`template`) and `native`
 * throw {@link UnsupportedContentError}, as does content WhatsApp cannot carry
 * (an invalid poll, an unusable media source).
 */

import { existsSync } from 'node:fs'
import type { AnyMessageContent, WAMessage, WAMessageKey } from '@whiskeysockets/baileys'
import { ProviderError, UnsupportedContentError, type MessageRef, type OutboundContent } from '@botmesh/core'
import { toMediaUpload, resolveRemoteMedia, makeSticker, transcodeToOpus, mediaToBufferFor, type RemoteMediaConfig, type WAMediaUpload } from './MediaProcessor.js'

/** WhatsApp shows at most 12 poll options. */
const POLL_MAX_OPTIONS = 12

/** Escape a vCard 3.0 text value (RFC 2426 §4): backslash, newline, comma and semicolon. */
function vcardText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function vcard(phone: string, displayName?: string): string {
  const oneLine = phone.replace(/[\r\n]+/g, ' ')
  const digits = phone.replace(/[^\d]/g, '')
  return (
    'BEGIN:VCARD\nVERSION:3.0\n' +
    `FN:${vcardText(displayName ?? oneLine)}\n` +
    `TEL;type=CELL;type=VOICE;waid=${digits}:${oneLine}\n` +
    'END:VCARD'
  )
}

function numberedButtons(text: string, rows: Array<{ title: string }>, footer?: string): string {
  const menu = rows.map((r, i) => `${i + 1}) ${r.title}`).join('\n')
  return [text, '', menu, footer ? `\n${footer}` : ''].filter(Boolean).join('\n')
}

/**
 * Reject a poll WhatsApp cannot carry or tally: votes select options by the
 * hash of their name, so duplicate names would be indistinguishable.
 */
function assertPoll(question: string, options: string[]): void {
  const fail = (why: string) => { throw new UnsupportedContentError('poll', `Invalid WhatsApp poll: ${why}`) }
  if (typeof question !== 'string' || !question.trim()) fail('the question is empty')
  if (!Array.isArray(options) || options.length < 2) fail('it needs at least 2 options')
  if (options.length > POLL_MAX_OPTIONS) fail(`it allows at most ${POLL_MAX_OPTIONS} options (got ${options.length})`)
  if (options.some((o) => typeof o !== 'string' || !o.trim())) fail('an option is empty')
  if (new Set(options).size !== options.length) fail('option names must be unique')
}

/**
 * The WhatsApp key of the message a reaction targets: the native key when the
 * ref came from this provider, otherwise one rebuilt from the ref (a ref read
 * back from a store loses `native`). Without the native key the author is
 * unknown, so the rebuilt key names someone else's message (`fromMe: false`).
 */
function reactionKey(target: MessageRef): WAMessageKey {
  const native = target.native as Partial<WAMessage> | undefined
  if (native && typeof native === 'object' && native.key?.id) return native.key
  return { remoteJid: target.chatId, id: target.id, fromMe: false }
}

export async function toOutbound(content: OutboundContent, remoteMedia: RemoteMediaConfig = {}): Promise<AnyMessageContent> {
  const upload = async (media: Parameters<typeof toMediaUpload>[0]): Promise<WAMediaUpload> => {
    let source: WAMediaUpload
    try {
      source = toMediaUpload(media)
    } catch (error) {
      throw new UnsupportedContentError(content.kind, `${content.kind} media source not supported: ${error instanceof Error ? error.message : String(error)}`)
    }
    // toMediaUpload passes a missing local path through as a URL; Baileys would fail on it later with ENOENT.
    if (!Buffer.isBuffer(source) && 'url' in source && !/^https?:\/\//i.test(source.url) && !existsSync(source.url)) {
      throw new UnsupportedContentError(content.kind, `${content.kind} media file not found: ${source.url} (pass an http(s) URL, a Buffer, a stream or an existing path)`)
    }
    return resolveRemoteMedia(source, content.kind, remoteMedia)
  }
  /** Run a local conversion; anything it throws that is not already typed becomes an UnsupportedContentError. */
  const convert = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof ProviderError) throw error
      const wrapped = new UnsupportedContentError(content.kind, `${what} failed: ${error instanceof Error ? error.message : String(error)}`)
      ;(wrapped as { cause?: unknown }).cause = error
      throw wrapped
    }
  }
  switch (content.kind) {
    case 'text':
      return { text: content.text }
    case 'image':
      return { image: await upload(content.media), caption: content.caption, viewOnce: content.viewOnce } as AnyMessageContent
    case 'video':
      return { video: await upload(content.media), caption: content.caption, gifPlayback: content.gifPlayback, ptv: content.ptv, viewOnce: content.viewOnce } as AnyMessageContent
    case 'audio':
      return { audio: await upload(content.media), mimetype: 'audio/ogg; codecs=opus', ptt: false } as AnyMessageContent
    case 'voice': {
      const input = await mediaToBufferFor(content.media, 'voice', remoteMedia)
      const opus = await convert('voice note transcode to Opus', () => transcodeToOpus(input))
      return { audio: opus, mimetype: 'audio/ogg; codecs=opus', ptt: true } as AnyMessageContent
    }
    case 'document':
      return { document: await upload(content.media), fileName: content.filename, caption: content.caption, mimetype: content.mimetype } as AnyMessageContent
    case 'sticker': {
      const input = await mediaToBufferFor(content.media, 'sticker', remoteMedia)
      const sticker = await convert('sticker conversion', () => makeSticker(input, { pack: content.pack, author: content.author }))
      return { sticker } as AnyMessageContent
    }
    case 'location':
      return { location: { degreesLatitude: content.lat, degreesLongitude: content.lng, name: content.name, address: content.address } }
    case 'contact':
      return { contacts: { displayName: content.displayName ?? content.phone, contacts: [{ vcard: vcard(content.phone, content.displayName) }] } }
    case 'form':
      throw new UnsupportedContentError('form', 'This transport has no native forms — flow().form() asks field by field instead (capabilities.forms is not "native").')
    case 'poll':
      assertPoll(content.question, content.options)
      return { poll: { name: content.question, values: content.options, selectableCount: content.multiSelect ? content.options.length : 1 } }
    case 'reaction':
      return { react: { text: content.emoji, key: reactionKey(content.target) } }
    case 'buttons':
      return { text: numberedButtons(content.text, content.buttons.map((b) => ({ title: b.title })), content.footer) }
    case 'list':
      return { text: numberedButtons(content.text, content.sections.flatMap((s) => s.rows), content.footer) }
    case 'card':
      return { text: [content.title, content.body].filter(Boolean).join('\n') }
    case 'template':
      throw new UnsupportedContentError('template', 'WhatsApp templates require the Cloud API transport, not Baileys.')
    case 'native':
      throw new UnsupportedContentError('native', 'Baileys has no native-component surface.')
  }
}
