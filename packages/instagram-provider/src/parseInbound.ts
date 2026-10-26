/**
 * parseInbound — turn an Instagram DM webhook body (the 'page' webhook object
 * used by the Messenger API for Instagram) into normalized {@link InboundEvent}s.
 *
 * Shape: `{ object:'page', entry:[{ messaging:[...] }] }`. Each messaging event
 * carries `sender.id` / `recipient.id` / `timestamp` (epoch **ms**) and one of:
 * `message` (text, attachments, quick_reply — `is_echo` marks our own messages),
 * `reaction`, `postback` or a story mention/reply. Identity is the IG user id
 * (IGSID) of the sender — stable, opaque.
 */

import { toInboundLocation } from '@botmesh/core/spi'
import type {
  InboundEvent,
  InboundInteraction,
  InboundLocation,
  InboundMessage,
  InboundReaction,
  MediaRef,
  MessageType,
} from '@botmesh/core'

/* Loose webhook shapes (only the fields we read). */
export interface IgAttachmentPayload {
  url?: string
  title?: string
  sticker_id?: string
  /** Set on a `location` attachment (shared with Messenger's webhook shape, when Meta sends one). */
  coordinates?: { lat?: number; long?: number }
}
export interface IgAttachment {
  /** image | video | audio | file | share | fallback | story_mention | ... */
  type?: string
  title?: string
  payload?: IgAttachmentPayload
}
export interface IgMessage {
  mid?: string
  text?: string
  /** True when this message was sent by the connected IG account (our own). */
  is_echo?: boolean
  /** True when the user unsent (deleted) the message `mid`. */
  is_deleted?: boolean
  /** True when IG could not render the message for the API (unsupported type). */
  is_unsupported?: boolean
  attachments?: IgAttachment[]
  quick_reply?: { payload?: string }
  reply_to?: { mid?: string }
  /** Present when the user replied to one of our stories. */
  story?: { id?: string; url?: string }
}
export interface IgReaction {
  /** id of the reacted-to message. */
  mid?: string
  /** 'react' | 'unreact' */
  action?: string
  /** The reaction as sent ('😀'). */
  reaction?: string
  /** The unicode emoji ('❤️'). */
  emoji?: string
}
export interface IgPostback {
  payload?: string
  title?: string
  mid?: string
}
export interface IgMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  /** Epoch milliseconds. */
  timestamp?: number
  message?: IgMessage
  reaction?: IgReaction
  postback?: IgPostback
  /** Present when the user replied to a story. */
  story?: { id?: string; url?: string }
}
export interface IgEntry {
  id?: string
  time?: number
  messaging?: IgMessagingEvent[]
}
export interface IgWebhookBody {
  /** 'page' for IG DMs via the Messenger API ('instagram' is also accepted). */
  object?: string
  entry?: IgEntry[]
}

/* Defensive readers: the webhook is external input, so a field of the wrong type is ignored, never trusted. */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const rec = <T extends object>(v: unknown): T | undefined =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Attachment types with a direct MediaRef mapping (token = hosted url). Null prototype: `constructor` is not a type. */
// The webhook carries no MIME type: each kind gets the usual one of the CDN (as in Messenger).
const ATTACH_MEDIA: Readonly<Record<string, { type: MessageType; kind: MediaRef['kind']; mimetype: string }>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, { type: MessageType; kind: MediaRef['kind']; mimetype: string }>,
  {
    image: { type: 'image', kind: 'image', mimetype: 'image/jpeg' },
    video: { type: 'video', kind: 'video', mimetype: 'video/mp4' },
    audio: { type: 'audio', kind: 'audio', mimetype: 'audio/aac' },
    file: { type: 'document', kind: 'document', mimetype: 'application/octet-stream' },
    story_mention: { type: 'image', kind: 'image', mimetype: 'image/jpeg' },
  },
))

/**
 * Id for a payload that arrived without a `mid`. Core dedupes inbound events by
 * `chatId` + id, so the id must be unique per logical event and stable across
 * redelivery: `ig_<timestamp>` (epoch ms, identical on a Meta retry) is both.
 * Without a timestamp there is nothing per-event to key on, so return `''`
 * (never deduplicated) instead of a shared constant like `ig_0`, which would
 * drop every later id-less event of the chat as a duplicate.
 */
function fallbackId(ev: IgMessagingEvent): string {
  const ts = num(ev.timestamp)
  return ts !== undefined ? `ig_${ts}` : ''
}

function toMessage(ev: IgMessagingEvent, chatId: string, msg: IgMessage): InboundMessage<IgMessagingEvent> {
  const text = str(msg.text)
  let type: MessageType = text ? 'text' : 'unknown'
  let body = text ?? ''
  let media: MediaRef | undefined
  let location: InboundLocation | undefined

  const att = rec<IgAttachment>(arr(msg.attachments)[0])
  if (att) {
    const payload = rec<IgAttachmentPayload>(att.payload)
    const url = str(payload?.url)
    const attType = str(att.type)
    if (attType === 'location') {
      // A shared location has no downloadable bytes.
      type = 'location'
      const title = str(payload?.title) ?? str(att.title)
      body = text ?? title ?? ''
      const c = rec<{ lat?: unknown; long?: unknown }>(payload?.coordinates)
      location = toInboundLocation({ latitude: c?.lat, longitude: c?.long, name: title })
    } else if (attType === 'share') {
      // A shared IG post — no media bytes, just a link/title.
      type = 'unknown'
      body = url ?? str(payload?.title) ?? str(att.title) ?? ''
    } else {
      const known = attType !== undefined ? ATTACH_MEDIA[attType] : undefined
      if (known && url) {
        type = known.type
        media = { kind: known.kind, mimetype: known.mimetype, token: url }
      } else {
        type = 'unknown'
        body = str(att.title) ?? str(payload?.title) ?? ''
      }
    }
  }
  const replyTo = str(rec<{ mid?: unknown }>(msg.reply_to)?.mid)

  return {
    ref: { id: str(msg.mid) ?? fallbackId(ev), chatId, native: ev },
    chat: { id: chatId, kind: 'dm', isGroup: false, isBroadcast: false },
    senderInfo: { id: chatId },
    from: chatId,
    sender: chatId,
    chatId,
    senderId: chatId,
    isGroup: false,
    isBroadcast: false,
    fromMe: false,
    type,
    body,
    timestamp: eventTime(ev.timestamp),
    mentions: [],
    media,
    ...(location ? { location } : {}),
    quoted: replyTo ? { ref: { id: replyTo, chatId } } : undefined,
    raw: ev,
  }
}

function toInteraction(ev: IgMessagingEvent, chatId: string, data: string, mid?: string): InboundInteraction<IgMessagingEvent> {
  const interactionId = mid ?? fallbackId(ev)
  return {
    interactionId,
    ref: { id: interactionId, chatId, native: ev },
    chat: { id: chatId, kind: 'dm', isGroup: false, isBroadcast: false },
    senderInfo: { id: chatId },
    from: chatId,
    sender: chatId,
    chatId,
    senderId: chatId,
    isGroup: false,
    kind: 'button',
    data,
    timestamp: eventTime(ev.timestamp),
    raw: ev,
  }
}

function toReaction(ev: IgMessagingEvent, chatId: string, r: IgReaction): InboundReaction {
  return {
    ref: { id: str(r.mid) ?? '', chatId, native: ev },
    emoji: str(r.emoji) ?? str(r.reaction) ?? '',
    senderId: chatId,
    removed: r.action === 'unreact',
  }
}

/**
 * Parse a full 'page' webhook body into a flat list of events. The body is
 * external input: a field of the wrong type is ignored, so a malformed payload
 * yields fewer events, never a throw or an event with non-string ids.
 */
/** Epoch ms of the event (the webhook sends ms); the receive time when it is missing. */
function eventTime(v: unknown): number {
  const ts = num(v)
  return ts !== undefined && ts > 0 ? Math.round(ts) : Date.now()
}

export function parseInbound(body: IgWebhookBody): InboundEvent[] {
  const events: InboundEvent[] = []
  const object = rec<IgWebhookBody>(body)?.object
  if (object !== 'page' && object !== 'instagram') return events

  for (const rawEntry of arr(body.entry)) {
    for (const rawEv of arr(rec<{ messaging?: unknown }>(rawEntry)?.messaging)) {
      const ev = rec<IgMessagingEvent>(rawEv)
      const chatId = str(rec<{ id?: unknown }>(ev?.sender)?.id)
      if (!ev || !chatId) continue

      // Reaction → reaction event.
      const reaction = rec<IgReaction>(ev.reaction)
      if (reaction) {
        events.push({ kind: 'reaction', reaction: toReaction(ev, chatId, reaction) })
        continue
      }
      // Get-started / menu postback → interaction.
      const postback = rec<IgPostback>(ev.postback)
      if (postback) {
        events.push({ kind: 'interaction', interaction: toInteraction(ev, chatId, str(postback.payload) ?? '', str(postback.mid)) })
        continue
      }

      const msg = rec<IgMessage>(ev.message)
      if (!msg) continue
      // is_echo = a message the connected IG account sent itself; skip it.
      if (msg.is_echo) continue
      // An unsend notification is not new input: never answer a deleted message.
      if (msg.is_deleted) continue
      // Quick reply tap → interaction (IG has no structured postback buttons).
      const quickReply = rec<{ payload?: unknown }>(msg.quick_reply)
      if (quickReply) {
        events.push({ kind: 'interaction', interaction: toInteraction(ev, chatId, str(quickReply.payload) ?? '', str(msg.mid)) })
        continue
      }
      events.push({ kind: 'message', message: toMessage(ev, chatId, msg) })
    }
  }
  return events
}
