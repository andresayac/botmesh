/**
 * HighLevel webhook body → normalized `InboundEvent`s.
 *
 * Handled: `InboundMessage` (SMS, WhatsApp, Email, FB, IG, Live chat, GMB,
 * Custom) → `message`; `InboundMessage` with `messageType: 'CALL'` → `call`.
 * Everything else (`OutboundMessage` echoes, contact/opportunity events…) is
 * ignored: those are CRM events, not conversation input.
 *
 * IDENTITY: `chatId` = `senderId` = the HighLevel `contactId`. HighLevel
 * already merges a person's phone, email and social handles into one contact,
 * so every channel of the same contact lands in the same chat; the channel of
 * each message is kept in `chat.platformData.channel` (and used to reply).
 */

import type { InboundEvent, MediaRef, MessageType } from '@botmesh/core'
import type { GhlChannel, GhlWebhookBody } from './types.js'
import { htmlToText, looksLikeHtml } from './html.js'

// Null prototype + own-property lookup: webhook-supplied names such as
// `constructor` must not resolve to inherited Object.prototype members.
const CHANNEL_ALIASES: Readonly<Record<string, GhlChannel>> = Object.assign(Object.create(null) as Record<string, GhlChannel>, {
  sms: 'SMS', type_sms: 'SMS',
  whatsapp: 'WhatsApp', type_whatsapp: 'WhatsApp',
  email: 'Email', type_email: 'Email',
  fb: 'FB', facebook: 'FB', type_facebook: 'FB',
  ig: 'IG', instagram: 'IG', type_instagram: 'IG',
  live_chat: 'Live_Chat', 'live chat': 'Live_Chat', livechat: 'Live_Chat', type_live_chat: 'Live_Chat',
  gmb: 'GMB', type_gmb: 'GMB',
  custom: 'Custom', type_custom_sms: 'Custom', type_custom_provider_sms: 'Custom',
})

function channelAlias(name: string): GhlChannel | undefined {
  return Object.hasOwn(CHANNEL_ALIASES, name) ? CHANNEL_ALIASES[name] : undefined
}

/**
 * A configured or per-send channel name in HighLevel's spelling: known names and
 * aliases match case-insensitively (`'whatsapp'` → `'WhatsApp'`, `'Live Chat'` →
 * `'Live_Chat'`); anything else is returned unchanged.
 */
export function canonicalChannel(name: string): GhlChannel {
  return channelAlias(name.trim().toLowerCase()) ?? name
}

/** HighLevel `messageType` / `messageTypeString` → send `type`, or undefined when unknown. */
export function channelOf(body: Pick<GhlWebhookBody, 'messageType' | 'messageTypeString'>): GhlChannel | undefined {
  for (const raw of [body.messageType, body.messageTypeString]) {
    if (typeof raw !== 'string' || !raw) continue
    const hit = channelAlias(raw.toLowerCase())
    if (hit) return hit
  }
  return undefined
}

function isCall(body: GhlWebhookBody): boolean {
  const t = `${body.messageType ?? ''}|${body.messageTypeString ?? ''}`.toUpperCase()
  return t.includes('CALL') || t.includes('VOICEMAIL')
}

/** Media kind from an attachment URL's extension. */
export function attachmentKind(url: string): MediaRef['kind'] {
  let path = url
  try { path = new URL(url).pathname } catch { /* keep raw */ }
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext)) return 'image'
  if (['mp4', 'mov', '3gp', 'webm', 'm4v', 'avi'].includes(ext)) return 'video'
  if (['mp3', 'ogg', 'oga', 'opus', 'm4a', 'wav', 'amr', 'aac'].includes(ext)) return 'audio'
  return 'document'
}

/** A non-empty string field (numbers are stringified); anything else is dropped. */
function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function timestampOf(body: GhlWebhookBody, now: () => number): number {
  const parsed = typeof body.dateAdded === 'string' ? Date.parse(body.dateAdded) : NaN
  return Number.isFinite(parsed) ? parsed : now()
}

/**
 * The message text. HighLevel sends an Email's HTML in `body` (with no
 * `contentType`, or `text/html`): it is turned into plain text so text triggers
 * match; `ctx.raw.body` keeps the original markup.
 */
function textOf(body: GhlWebhookBody, channel: GhlChannel | undefined): string {
  const text = typeof body.body === 'string' ? body.body : ''
  const contentType = typeof body.contentType === 'string' ? body.contentType.toLowerCase() : undefined
  const html = contentType !== undefined
    ? contentType.includes('html')
    : channel === 'Email'
  return html && looksLikeHtml(text) ? htmlToText(text) : text
}

export interface ParsedGhl {
  events: InboundEvent<GhlWebhookBody>[]
  /** The channel a contact last wrote on (reply routing). */
  channel?: { contactId: string; channel: GhlChannel }
}

export function parseInbound(body: GhlWebhookBody, now: () => number = Date.now): ParsedGhl {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { events: [] }
  if (body.type !== 'InboundMessage') return { events: [] }
  if (body.direction !== undefined && body.direction !== 'inbound') return { events: [] }
  const contactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : undefined
  if (!contactId) return { events: [] }
  const id = str(body.messageId) ?? str(body.webhookId) ?? ''
  const conversationId = str(body.conversationId)
  const from = str(body.from)
  const to = str(body.to)

  if (isCall(body)) {
    return {
      events: [{
        kind: 'call',
        event: { id, from: contactId, status: str(body.callStatus) ?? str(body.status) ?? 'unknown', chatId: contactId, isGroup: false },
      }],
    }
  }

  const channel = channelOf(body)
  const platformData: Record<string, unknown> = {
    ...(channel ? { channel } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(typeof body.locationId === 'string' && body.locationId ? { locationId: body.locationId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(str(body.subject) ? { subject: str(body.subject) } : {}),
    ...(str(body.threadId) ? { threadId: str(body.threadId) } : {}),
    ...(str(body.emailMessageId) ? { emailMessageId: str(body.emailMessageId) } : {}),
  }
  const attachments = Array.isArray(body.attachments) ? Array.from(body.attachments as unknown[]).filter((a): a is string => typeof a === 'string' && a.length > 0) : []
  let type: MessageType = 'text'
  let media: MediaRef | undefined
  if (attachments.length > 0) {
    const kind = attachmentKind(attachments[0]!)
    type = kind
    media = { kind, token: { url: attachments[0] } }
  }
  const text = textOf(body, channel)

  return {
    ...(channel ? { channel: { contactId, channel } } : {}),
    events: [{
      kind: 'message',
      message: {
        ref: { id, chatId: contactId, native: { messageId: id || undefined, conversationId, channel } },
        chat: { id: contactId, kind: 'dm', isGroup: false, isBroadcast: false, platformData },
        senderInfo: { id: contactId, platformData: { ...(from ? { address: from } : {}), ...(channel ? { channel } : {}) } },
        from: contactId, sender: contactId, chatId: contactId, senderId: contactId,
        isGroup: false,
        isBroadcast: false,
        fromMe: false,
        type,
        body: text,
        timestamp: timestampOf(body, now),
        mentions: [],
        ...(media ? { media } : {}),
        raw: body,
      },
    }],
  }
}
