/**
 * toOutbound — map a transport-neutral {@link OutboundContent} to a Messenger
 * Send API `message` object (the value under `message` in the
 * `POST /{page-id}/messages` request; sender actions are sent separately).
 *
 * Media is resolved to a public URL by the provider BEFORE this is called —
 * the Send API takes `{ attachment: { type, payload: { url, is_reusable } } }`
 * and this provider does not implement chunked upload. Polls, reactions,
 * location, contact and Cloud-API-style templates have no Send API endpoint and
 * throw {@link UnsupportedContentError}.
 */

import { UnsupportedContentError, splitMessage, type Button, type OutboundContent } from '@botmesh/core'

/**
 * Send API limits: button titles 20 chars, generic-template titles/subtitles 80,
 * button-template text 640, 3 buttons per template.
 */
const BUTTON_TITLE = 20
const ELEMENT_TEXT = 80
const BUTTON_TEXT = 640
const MAX_BUTTONS = 3
/** Generic template: at most 10 elements (one per list row). */
const MAX_ELEMENTS = 10
/** Send API `text` limit (the provider's `maxTextLength`). */
const TEXT_MAX = 2000

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

/** Plain text as Send API messages within the 2000-char limit (several when longer). */
function textMessages(text: string): Array<Record<string, unknown>> {
  if (text.length <= TEXT_MAX) return [{ text }]
  return splitMessage(text, { maxLength: TEXT_MAX, format: 'plain' }).map((part) => ({ text: part }))
}

/**
 * Split `text` so its tail fits a button template (640 chars): the parts before it go
 * as plain text messages (each within the 2000-char Send API limit), the tail carries
 * the buttons. Nothing is cut.
 */
function splitForTemplate(text: string): { head: string[]; tail: string } {
  if (text.length <= BUTTON_TEXT) return { head: [], tail: text }
  const parts = splitMessage(text, { maxLength: BUTTON_TEXT, format: 'plain' })
  const tail = parts[parts.length - 1] ?? ''
  const at = text.lastIndexOf(tail)
  const rest = at > 0 ? text.slice(0, at).trimEnd() : parts.slice(0, -1).join('\n')
  return { head: rest ? splitMessage(rest, { maxLength: TEXT_MAX, format: 'plain' }) : [], tail }
}

/**
 * Reject more options than the Send API shows (like the Cloud API does), rather than
 * dropping the ones the user would never see.
 */
function assertAtMost(kind: OutboundContent['kind'], what: string, count: number, max: number): void {
  if (count > max) throw new UnsupportedContentError(kind, `Messenger allows at most ${max} ${what}; got ${count}. Split the options or use a numbered text menu.`)
}

/** A URL button opens the link (web_url); any other button posts its id back (postback). */
function sendApiButton(b: Pick<Button, 'id' | 'title'> & { url?: string }): Record<string, unknown> {
  const title = cut(b.title, BUTTON_TITLE)
  return b.url
    ? { type: 'web_url', title, url: b.url }
    // An empty payload is rejected by the Send API: fall back to the title.
    : { type: 'postback', title, payload: b.id || b.title }
}

function genericTemplate(elements: Array<Record<string, unknown>>): Record<string, unknown> {
  return { attachment: { type: 'template', payload: { template_type: 'generic', elements } } }
}

function buttonTemplate(kind: 'buttons' | 'card', text: string, buttons: Button[]): Record<string, unknown> {
  assertAtMost(kind, 'buttons per template', buttons.length, MAX_BUTTONS)
  return {
    attachment: {
      type: 'template',
      payload: { template_type: 'button', text, buttons: buttons.map(sendApiButton) },
    },
  }
}

type CardContent = Extract<OutboundContent, { kind: 'card' }>

/**
 * A card as one or more Send API messages, never losing text:
 *  - no image and no buttons: one text message;
 *  - title and body fit a generic-template element (80 chars each): one generic
 *    template with image and buttons;
 *  - otherwise the 80-char cut would drop text, so the card is split: the image
 *    (if any) as an attachment, then the full text with the buttons as a button
 *    template (or, past 640 chars, the text alone followed by a button template
 *    titled with the card title).
 */
function cardMessages(content: CardContent): Array<Record<string, unknown>> {
  const text = [content.title, content.body].filter(Boolean).join('\n')
  const buttons = content.buttons ?? []
  if (!content.imageUrl && !buttons.length) return textMessages(text)
  assertAtMost('card', 'buttons per template', buttons.length, MAX_BUTTONS)
  const fits = Array.from(content.title).length <= ELEMENT_TEXT && Array.from(content.body ?? '').length <= ELEMENT_TEXT
  if (fits) {
    return [genericTemplate([{
      title: content.title,
      ...(content.body ? { subtitle: content.body } : {}),
      ...(content.imageUrl ? { image_url: content.imageUrl } : {}),
      ...(buttons.length ? { buttons: buttons.map(sendApiButton) } : {}),
    }])]
  }
  const messages: Array<Record<string, unknown>> = []
  if (content.imageUrl) messages.push(attachmentMessage('image', content.imageUrl))
  if (!buttons.length) messages.push(...textMessages(text))
  else if (text.length <= BUTTON_TEXT) messages.push(buttonTemplate('card', text, buttons))
  else if (content.title.trim()) messages.push(...textMessages(text), buttonTemplate('card', cut(content.title, BUTTON_TEXT), buttons))
  else {
    const { head, tail } = splitForTemplate(text)
    messages.push(...head.map((part) => ({ text: part })), buttonTemplate('card', tail, buttons))
  }
  return messages
}

type ButtonsContent = Extract<OutboundContent, { kind: 'buttons' }>

/** Buttons as a button template; text past 640 chars goes first as plain text, no buttons → text. */
function buttonsMessages(content: ButtonsContent): Array<Record<string, unknown>> {
  if (!content.buttons.length) return textMessages(content.text)
  assertAtMost('buttons', 'buttons per template', content.buttons.length, MAX_BUTTONS)
  const { head, tail } = splitForTemplate(content.text)
  return [...head.map((text) => ({ text })), buttonTemplate('buttons', tail, content.buttons)]
}

type ListContent = Extract<OutboundContent, { kind: 'list' }>

/**
 * A list as a generic template, one element per row (max 10), each with a postback
 * button carrying the row id. The template has no header, so the list text goes
 * first as its own message; a list without rows is just its text.
 */
function listMessages(content: ListContent): Array<Record<string, unknown>> {
  const rows = content.sections.flatMap((s) => s.rows)
  assertAtMost('list', 'list rows (generic template elements)', rows.length, MAX_ELEMENTS)
  if (!rows.length) return textMessages(content.text)
  const elements = rows.map((r) => ({
    title: cut(r.title, ELEMENT_TEXT),
    ...(r.description ? { subtitle: cut(r.description, ELEMENT_TEXT) } : {}),
    buttons: [sendApiButton(r)],
  }))
  return [...(content.text.trim() ? textMessages(content.text) : []), genericTemplate(elements)]
}

function attachmentMessage(type: 'image' | 'video' | 'audio' | 'file', url: string | undefined): Record<string, unknown> {
  if (!url) {
    throw new UnsupportedContentError('image', 'Messenger needs a public URL (or upload the media first).')
  }
  return { attachment: { type, payload: { url, is_reusable: true } } }
}

/**
 * Map content to the ordered list of Send API `message` payloads that carry it.
 * Most kinds are a single message. Several messages, so no text is cut: a `list`
 * (its text, then the generic template), `buttons` whose text exceeds the 640-char
 * button template (the leading text, then the template), and a `card` whose title
 * or body exceeds the 80-char generic-template limit (image, then text/buttons).
 * The provider's `send()` posts them in order.
 */
export function toOutboundMessages(content: OutboundContent, mediaUrl?: string): Array<Record<string, unknown>> {
  switch (content.kind) {
    case 'card': return cardMessages(content)
    case 'buttons': return buttonsMessages(content)
    case 'list': return listMessages(content)
    default: return [toOutbound(content, mediaUrl)]
  }
}

/**
 * Single-message mapping. For content that needs several messages (a `list` with
 * text, long `buttons` text, a long `card`) it returns only the last one of
 * {@link toOutboundMessages} (the template); use that function to send it whole.
 *
 * @returns the `message` payload ready to wrap in
 *   `{ recipient:{id}, messaging_type:'RESPONSE', message }`.
 */
export function toOutbound(content: OutboundContent, mediaUrl?: string): Record<string, unknown> {
  switch (content.kind) {
    case 'text':
      return { text: content.text }

    case 'image':
      return attachmentMessage('image', mediaUrl)
    case 'video':
      return attachmentMessage('video', mediaUrl)
    case 'audio':
    case 'voice':
      return attachmentMessage('audio', mediaUrl)
    case 'document':
      return attachmentMessage('file', mediaUrl)

    case 'buttons':
    case 'list':
    case 'card': {
      // Content that needs several messages (see toOutboundMessages) maps to its
      // last one here: the template.
      const messages = toOutboundMessages(content)
      return messages[messages.length - 1] as Record<string, unknown>
    }

    case 'native':
      if (content.provider !== 'messenger') {
        throw new UnsupportedContentError('native', `native content for '${content.provider}' cannot be sent through Messenger (use ctx.sendNative('messenger', message))`)
      }
      if (content.payload === null || typeof content.payload !== 'object' || Array.isArray(content.payload)) {
        throw new UnsupportedContentError('native', 'Messenger native payload must be a Send API `message` object')
      }
      return content.payload as Record<string, unknown>

    case 'sticker':
      throw new UnsupportedContentError('sticker', 'Messenger has no Send API for stickers — send the image instead (kind image).')
    case 'form':
      throw new UnsupportedContentError('form', 'This transport has no native forms — flow().form() asks field by field instead (capabilities.forms is not "native").')
    case 'poll':
      throw new UnsupportedContentError('poll', 'Messenger has no Send API for polls — use buttons (kind buttons) or a generic template list.')
    case 'reaction':
      throw new UnsupportedContentError('reaction', 'Sending reactions has no public Send API endpoint on Messenger (they arrive inbound only).')
    case 'location':
      throw new UnsupportedContentError('location', 'Sending locations has no Send API endpoint on Messenger — send a map link as text.')
    case 'contact':
      throw new UnsupportedContentError('contact', 'Sending contacts has no Send API endpoint on Messenger — send the contact as text.')
    case 'template':
      throw new UnsupportedContentError('template', 'Messenger has no Cloud-API-style template messages — use text, buttons or a generic template (kind list).')
  }
}
