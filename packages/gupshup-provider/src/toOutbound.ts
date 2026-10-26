/**
 * `OutboundContent` → Gupshup `message` object (`POST /wa/api/v1/msg`), or a
 * template request (`POST /wa/api/v1/template/msg`).
 *
 *  - Media by public URL (`url` / `originalUrl`).
 *  - `buttons` (≤ 3, no URL buttons) → `quick_reply` with `postbackText` = button id;
 *    more buttons → `list`; anything else → numbered text.
 *  - `list` → interactive `list` (`postbackText` = row id).
 *  - `template` → `{ id: name, params }`.
 *  - `native` → the payload is sent as the `message` object verbatim.
 */

import { UnsupportedContentError, type Button, type ListSection, type MediaSource, type OutboundContent } from '@botmesh/core'
import { numberedText } from './http.js'

export type GupshupOutbound =
  | { endpoint: 'msg'; message: Record<string, unknown> }
  | { endpoint: 'template'; template: { id: string; params: string[] } }

export function mediaUrlOf(source: MediaSource, kind: OutboundContent['kind']): string {
  if (typeof source === 'string' && /^https?:\/\//i.test(source)) return source
  if (typeof source === 'object' && source !== null && !Buffer.isBuffer(source)) {
    if ('url' in source && typeof source.url === 'string') return source.url
    if ('native' in source && typeof source.native === 'string' && /^https?:\/\//i.test(source.native)) return source.native
  }
  throw new UnsupportedContentError(
    kind,
    `Gupshup sends media from a public URL — got a non-URL MediaSource for '${kind}'. Host the file and pass its URL.`,
  )
}

/** Max quick-reply options WhatsApp allows. */
const MAX_QUICK_REPLIES = 3
/** Max rows across a WhatsApp list. */
const MAX_LIST_ROWS = 10

/**
 * WhatsApp limits of the interactive labels this mapper cuts (in characters):
 * past them Gupshup answers an opaque "Invalid request".
 */
const LIMITS = { buttonTitle: 20, listButton: 20, sectionTitle: 24, rowTitle: 24, rowDescription: 72, footer: 60 } as const

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * At most `max` characters (code points), cut on a grapheme boundary: an emoji ZWJ
 * sequence, a flag or a letter with combining marks is kept whole or dropped whole.
 */
function cut(text: string, max: number): string {
  if (Array.from(text).length <= max) return text
  let out = ''
  let used = 0
  for (const { segment } of graphemes.segment(text)) {
    const size = Array.from(segment).length
    if (used + size > max) break
    out += segment
    used += size
  }
  return out
}

function listMessage(text: string, buttonText: string, sections: ListSection[], footer?: string): Record<string, unknown> {
  return {
    type: 'list',
    body: text,
    ...(footer ? { footer: cut(footer, LIMITS.footer) } : {}),
    globalButtons: [{ type: 'text', title: cut(buttonText, LIMITS.listButton) }],
    items: sections.map((section, index) => ({
      title: cut(section.title ?? `${index + 1}`, LIMITS.sectionTitle),
      options: section.rows.map((row) => ({
        type: 'text',
        title: cut(row.title, LIMITS.rowTitle),
        ...(row.description ? { description: cut(row.description, LIMITS.rowDescription) } : {}),
        postbackText: row.id,
      })),
    })),
  }
}

function buttonsMessage(text: string, buttons: Button[], footer: string | undefined, listButtonText: string): Record<string, unknown> {
  if (buttons.length <= MAX_QUICK_REPLIES && buttons.every((b) => !b.url)) {
    const titles = buttons.map((b) => cut(b.title, LIMITS.buttonTitle))
    const repeated = titles.find((title, index) => titles.indexOf(title) !== index)
    if (repeated !== undefined) {
      throw new UnsupportedContentError(
        'buttons',
        `WhatsApp quick replies need unique titles; ${JSON.stringify(repeated)} repeats (titles are compared after the ${LIMITS.buttonTitle}-character cut).`,
      )
    }
    return {
      type: 'quick_reply',
      content: { type: 'text', text, ...(footer ? { caption: cut(footer, LIMITS.footer) } : {}) },
      options: buttons.map((b, index) => ({ type: 'text', title: titles[index], postbackText: b.id })),
    }
  }
  if (buttons.length <= MAX_LIST_ROWS && buttons.every((b) => !b.url)) {
    return listMessage(text, listButtonText, [{ rows: buttons.map((b) => ({ id: b.id, title: b.title })) }], footer)
  }
  return { type: 'text', text: numberedText(text, buttons, footer) }
}

function templateParams(components: unknown): string[] {
  if (components === undefined) return []
  if (Array.isArray(components)) return components.map((c) => String(c))
  if (components && typeof components === 'object' && Array.isArray((components as { params?: unknown }).params)) {
    return ((components as { params: unknown[] }).params).map((c) => String(c))
  }
  throw new UnsupportedContentError('template', 'Gupshup template components must be a params array (or { params: [...] })')
}

/** Options of {@link toOutbound}. */
export interface GupshupOutboundOptions {
  /** Label of the list button when `buttons` degrade to a list. Default `'Options'`. */
  listButtonText?: string
}

/** Default label of the list button when `buttons` degrade to a list. */
export const DEFAULT_LIST_BUTTON_TEXT = 'Options'

export function toOutbound(content: OutboundContent, options: GupshupOutboundOptions = {}): GupshupOutbound {
  const msg = (message: Record<string, unknown>): GupshupOutbound => ({ endpoint: 'msg', message })
  switch (content.kind) {
    case 'text':
      return msg({ type: 'text', text: content.text })
    case 'image': {
      const url = mediaUrlOf(content.media, content.kind)
      return msg({ type: 'image', originalUrl: url, previewUrl: url, ...(content.caption ? { caption: content.caption } : {}) })
    }
    case 'video':
      return msg({ type: 'video', url: mediaUrlOf(content.media, content.kind), ...(content.caption ? { caption: content.caption } : {}) })
    case 'audio':
    case 'voice':
      return msg({ type: 'audio', url: mediaUrlOf(content.media, content.kind) })
    case 'document':
      return msg({
        type: 'file',
        url: mediaUrlOf(content.media, content.kind),
        filename: content.filename ?? 'file',
        ...(content.caption ? { caption: content.caption } : {}),
      })
    case 'sticker':
      return msg({ type: 'sticker', url: mediaUrlOf(content.media, content.kind) })
    case 'location':
      return msg({
        type: 'location', longitude: content.lng, latitude: content.lat,
        ...(content.name ? { name: content.name } : {}), ...(content.address ? { address: content.address } : {}),
      })
    case 'contact':
      return msg({
        type: 'contact',
        contact: {
          name: { formattedName: content.displayName ?? content.phone, firstName: content.displayName ?? content.phone },
          phones: [{ phone: content.phone, type: 'Mobile' }],
        },
      })
    case 'buttons':
      return msg(buttonsMessage(content.text, content.buttons, content.footer, options.listButtonText ?? DEFAULT_LIST_BUTTON_TEXT))
    case 'list':
      if (content.sections.reduce((n, s) => n + s.rows.length, 0) > MAX_LIST_ROWS) {
        return msg({ type: 'text', text: numberedText(content.text, content.sections.flatMap((s) => s.rows), content.footer) })
      }
      return msg(listMessage(content.text, content.buttonText, content.sections, content.footer))
    case 'template':
      return { endpoint: 'template', template: { id: content.name, params: templateParams(content.components) } }
    case 'native': {
      if (content.provider !== 'gupshup') {
        throw new UnsupportedContentError('native', `native content for '${content.provider}' cannot be sent through Gupshup`)
      }
      const payload = content.payload
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new UnsupportedContentError('native', 'Gupshup native payload must be a message object')
      }
      return msg({ ...(payload as Record<string, unknown>) })
    }
    default:
      throw new UnsupportedContentError(content.kind, `Gupshup cannot send '${content.kind}' content`)
  }
}
