/**
 * toOutbound — map a transport-neutral {@link OutboundContent} to the Instagram
 * DM Send API `message` object (the value under `message` in the Graph request).
 *
 * The Messenger API for Instagram is URL-based: attachments require a publicly
 * reachable URL. Buffer/path/stream sources are rejected with
 * {@link UnsupportedContentError} (there is no media-upload endpoint for IG DMs).
 * IG supports quick replies but NOT structured buttons, lists, polls, reactions
 * send, location or contact cards — those degrade or throw per capability.
 */

import { UnsupportedContentError, splitMessage, type MediaSource, type OutboundContent } from '@botmesh/core'

const URL_RE = /^https?:\/\//i

/** IG DM media must be a hosted URL; anything else is rejected with a clear note. */
function mediaUrl(source: MediaSource, kind: OutboundContent['kind']): string {
  if (typeof source === 'string') {
    if (URL_RE.test(source)) return source
    throw new UnsupportedContentError(
      kind,
      `Instagram DM media needs a hosted URL (got a local path "${source}"). Host the file somewhere public and pass its URL (or { url }).`,
    )
  }
  if (Buffer.isBuffer(source)) {
    throw new UnsupportedContentError(kind, 'Instagram DM cannot send raw buffers — provide a hosted URL (https string or { url }).')
  }
  if ('url' in source) {
    if (typeof source.url === 'string' && URL_RE.test(source.url)) return source.url
    throw new UnsupportedContentError(kind, 'Instagram DM media { url } must be an http(s) URL of a publicly hosted file.')
  }
  if ('native' in source) {
    const n = source.native
    if (typeof n === 'string' && URL_RE.test(n)) return n
    const nested = n && typeof n === 'object' ? (n as { url?: unknown }).url : undefined
    if (typeof nested === 'string' && URL_RE.test(nested)) return nested
    throw new UnsupportedContentError(kind, 'Instagram DM media via native requires a hosted http(s) URL string or { url }.')
  }
  throw new UnsupportedContentError(
    kind,
    'Instagram DM Send API is URL-based only (hosted URL / IG media_id); buffer/path/stream sources are unsupported.',
  )
}

/** IG quick replies: at most 13 (more rejects instead of dropping some), titles up to 20 characters, payloads up to 1000. */
const MAX_QUICK_REPLIES = 13
const MAX_TITLE = 20
const MAX_PAYLOAD = 1000

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** First `max` user-perceived characters (graphemes: an emoji sequence or an accent is never split). */
function cut(text: string, max: number): string {
  let out = ''
  let n = 0
  for (const { segment } of graphemes.segment(text)) {
    if (n++ === max) return out
    out += segment
  }
  return out
}

/** The text a quick-reply message carries: Meta rejects quick replies without one. */
function quickReplyText(kind: 'buttons' | 'card', text: string): string {
  if (text.trim() === '') {
    throw new UnsupportedContentError(kind, 'Instagram quick replies need a non-empty text (the message the chips are attached to).')
  }
  return text
}

/** Quick replies for `kind`; an empty payload falls back to the title. */
function quickReplies(kind: 'buttons' | 'card', buttons: ReadonlyArray<{ id: string; title: string }>): Array<Record<string, unknown>> {
  if (buttons.length > MAX_QUICK_REPLIES) {
    throw new UnsupportedContentError(kind, `Instagram allows at most ${MAX_QUICK_REPLIES} quick replies; got ${buttons.length}. Split the options or use a numbered text menu.`)
  }
  const payloads = new Set<string>()
  const titles = new Set<string>()
  return buttons.map((b, i) => {
    const title = cut(typeof b.title === 'string' ? b.title.trim() : '', MAX_TITLE)
    if (title === '') throw new UnsupportedContentError(kind, `Instagram quick reply #${i + 1} has an empty title.`)
    const payload = (typeof b.id === 'string' && b.id) || title
    if (payload.length > MAX_PAYLOAD) {
      throw new UnsupportedContentError(kind, `Instagram quick reply #${i + 1}: the id is ${payload.length} characters; the payload limit is ${MAX_PAYLOAD}.`)
    }
    if (payloads.has(payload)) throw new UnsupportedContentError(kind, `Instagram quick replies need unique ids; duplicate id "${cut(payload, 40)}".`)
    if (titles.has(title)) {
      throw new UnsupportedContentError(kind, `Instagram quick replies need distinct titles (cut to ${MAX_TITLE} characters); duplicate title "${title}".`)
    }
    payloads.add(payload)
    titles.add(title)
    return { content_type: 'text', title, payload }
  })
}

function attachment(type: string, url: string): Record<string, unknown> {
  return { attachment: { type, payload: { url, is_reusable: true } } }
}

/** Degrade a list to a numbered-text message (IG has no list messages). */
function listAsText(content: Extract<OutboundContent, { kind: 'list' }>): string {
  const lines: string[] = []
  let n = 1
  for (const section of content.sections) {
    if (section.title) lines.push(section.title)
    for (const row of section.rows) lines.push(`${n++}. ${row.title}`)
  }
  return [content.text, lines.join('\n'), content.footer].filter(Boolean).join('\n\n')
}

/**
 * @returns the Send API `message` payload: `{ text }`,
 *   `{ text, quick_replies }` or `{ attachment: { type, payload: { url } } }`.
 */
export function toOutbound(content: OutboundContent): Record<string, unknown> {
  switch (content.kind) {
    case 'text':
      return { text: content.text }

    case 'image':
      return attachment('image', mediaUrl(content.media, 'image'))
    case 'video':
      return attachment('video', mediaUrl(content.media, 'video'))
    case 'audio':
    case 'voice':
      return attachment('audio', mediaUrl(content.media, 'audio'))
    case 'document':
      return attachment('file', mediaUrl(content.media, 'document'))

    case 'buttons': {
      // IG supports quick replies (tappable chips), NOT structured buttons.
      if (content.buttons.length === 0) return { text: content.text }
      return { text: quickReplyText('buttons', content.text), quick_replies: quickReplies('buttons', content.buttons) }
    }

    case 'list':
      // No list messages in IG DMs — degrade to numbered text.
      return { text: listAsText(content) }

    case 'card': {
      // Degrades to text; its buttons survive as quick replies.
      const text = [content.title, content.body].filter(Boolean).join('\n')
      return content.buttons?.length ? { text: quickReplyText('card', text), quick_replies: quickReplies('card', content.buttons) } : { text }
    }

    case 'native':
      if (content.provider !== 'instagram') {
        throw new UnsupportedContentError('native', `native content for '${content.provider}' cannot be sent through Instagram (use ctx.sendNative('instagram', message))`)
      }
      if (content.payload === null || typeof content.payload !== 'object' || Array.isArray(content.payload)) {
        throw new UnsupportedContentError('native', 'Instagram native payload must be a Send API `message` object')
      }
      return content.payload as Record<string, unknown>

    case 'form':
      throw new UnsupportedContentError('form', 'This transport has no native forms — flow().form() asks field by field instead (capabilities.forms is not "native").')
    case 'poll':
      throw new UnsupportedContentError('poll', 'Instagram DM has no poll messages — use quick replies (kind buttons) instead.')
    case 'reaction':
      throw new UnsupportedContentError('reaction', 'Instagram DM reactions cannot be sent through a simple Send API endpoint (inbound reactions are received).')
    case 'location':
      throw new UnsupportedContentError('location', 'Instagram DM has no location messages — send a maps link as text.')
    case 'contact':
      throw new UnsupportedContentError('contact', 'Instagram DM has no contact-card messages — send the contact info as text.')
    case 'sticker':
      throw new UnsupportedContentError('sticker', 'Instagram DM Send API does not accept sticker messages.')
    case 'template':
      throw new UnsupportedContentError('template', 'Instagram DM has no message templates (WhatsApp Cloud API only).')
  }
}

/** One Send API call of an outbound content: `primary` is the message the send result points at. */
export interface OutboundPart {
  message: Record<string, unknown>
  /** A failed primary part rejects the send; a failed secondary part is logged and skipped. */
  primary: boolean
}

/** Send API text limit (UTF-8 bytes). */
const MAX_TEXT_BYTES = 1000

/**
 * Every Send API message for `content`, in order. Instagram attachments carry no caption and
 * quick-reply messages no image, so a media caption follows its attachment as text (split at
 * 1000 bytes) and a card image precedes the card text.
 */
export function toOutboundParts(content: OutboundContent): OutboundPart[] {
  const main = { message: toOutbound(content), primary: true }
  if ((content.kind === 'image' || content.kind === 'video' || content.kind === 'document') && content.caption?.trim()) {
    const captions = splitMessage(content.caption, { maxBytes: MAX_TEXT_BYTES, format: 'plain' })
    return [main, ...captions.map((text) => ({ message: { text }, primary: false }))]
  }
  if (content.kind === 'card' && content.imageUrl !== undefined && content.imageUrl !== '') {
    return [{ message: attachment('image', mediaUrl(content.imageUrl, 'card')), primary: false }, main]
  }
  return [main]
}
