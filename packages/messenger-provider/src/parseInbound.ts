/**
 * parseInbound — turn a Facebook Messenger `page` webhook body into normalized
 * {@link InboundEvent}s. Identity is the Page-Scoped User id (`sender.id`):
 * stable per page↔user pair, no aliasing to reconcile.
 *
 * Webhook shape: `{ object:'page', entry:[{ messaging:[ {sender, recipient,
 * timestamp, message|reaction|postback|opt_in|referral} ] }] }`.
 *
 * The body is external input: every field is read defensively (a value of the
 * wrong type is ignored), so a malformed payload yields fewer events, never a
 * throw or an event with non-string ids.
 */

import type {
  InboundEvent,
  InboundLocation,
  InboundMessage,
  MediaRef,
  MessageType,
} from '@botmesh/core'
import { toInboundLocation } from '@botmesh/core/spi'

/* Loose Messenger webhook shapes (only the fields we read). */

export interface MessengerAttachment {
  type?: string // 'image' | 'video' | 'audio' | 'file' | 'location' | 'fallback'
  /** `coordinates` is set on a `location` attachment (when Meta still sends one). */
  payload?: { url?: string; title?: string; coordinates?: { lat?: number; long?: number } }
}

export interface MessengerMessage {
  mid?: string
  text?: string
  attachments?: MessengerAttachment[]
  quick_reply?: { payload?: string }
  /** Present when the user replied to a specific message. */
  reply_to?: { mid?: string }
  sticker_id?: number
  is_echo?: boolean
  /** Legacy placement of a reaction; Meta sends it as the top-level {@link MessagingEvent.reaction}. */
  reaction?: { reaction?: string; emoji?: string; action?: string; mid?: string }
}

export interface MessagingEvent {
  sender?: { id?: string; user_ref?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: MessengerMessage
  /**
   * `message_reactions` webhook: `reaction` names it (`love`, `smile`…), `emoji`
   * is the unicode character, `action` is `react` | `unreact`, `mid` the message
   * reacted to.
   */
  reaction?: { reaction?: string; emoji?: string; action?: string; mid?: string }
  postback?: { mid?: string; payload?: string; title?: string }
  optin?: { ref?: string; user_ref?: string; payload?: string }
  referral?: { ref?: string; source?: string; type?: string }
}

export interface PageWebhookBody {
  object?: string
  entry?: Array<{ id?: string; time?: number; messaging?: MessagingEvent[] }>
}

/* Defensive readers: a field of the wrong type is ignored, never trusted. */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const rec = <T extends object>(v: unknown): T | undefined =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Null-prototype lookup table: an attachment `type` such as `constructor` must not hit Object.prototype. */
const ATTACH_MIME: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/aac',
  file: 'application/octet-stream',
}))

type Reaction = NonNullable<MessagingEvent['reaction']>

/** Map a Messenger attachment type to a neutral MessageType (files → document). */
function attachType(type: string | undefined): MessageType {
  switch (type) {
    case 'image': return 'image'
    case 'video': return 'video'
    case 'audio': return 'audio'
    case 'location': return 'location'
    default: return 'document' // 'file', 'fallback', anything else
  }
}

function toMessage(ev: MessagingEvent, chatId: string, m: MessengerMessage, selfId?: string): InboundMessage<MessagingEvent> {
  const text = typeof m.text === 'string' ? m.text : undefined
  const attach = rec<MessengerAttachment>(arr(m.attachments)[0])
  let type: MessageType = text !== undefined ? 'text' : 'unknown'
  let body = text ?? ''
  let media: MediaRef | undefined
  let location: InboundLocation | undefined

  if (attach) {
    const attachKind = str(attach.type)
    const payload = rec<NonNullable<MessengerAttachment['payload']>>(attach.payload)
    type = attachType(attachKind)
    // A shared location has no downloadable bytes.
    if (type === 'location') {
      body = text ?? str(payload?.title) ?? ''
      const c = rec<{ lat?: unknown; long?: unknown }>(payload?.coordinates)
      location = toInboundLocation({ latitude: c?.lat, longitude: c?.long, name: str(payload?.title) })
    } else {
      // Messenger attachments carry no caption; text doubles as one.
      media = {
        kind: type as MediaRef['kind'],
        mimetype: (attachKind !== undefined ? ATTACH_MIME[attachKind] : undefined) ?? 'application/octet-stream',
        token: str(payload?.url),
      }
    }
  }
  const replyTo = str(rec<{ mid?: unknown }>(m.reply_to)?.mid)

  return {
    ref: { id: str(m.mid) ?? '', chatId, native: ev },
    chat: { id: chatId, kind: 'dm', isGroup: false, isBroadcast: false },
    senderInfo: { id: chatId },
    from: chatId,
    sender: chatId,
    chatId,
    senderId: chatId,
    isGroup: false,
    isBroadcast: false,
    fromMe: !!selfId && chatId === selfId,
    type,
    body,
    timestamp: eventTime(ev.timestamp),
    mentions: [],
    media,
    ...(location ? { location } : {}),
    ...(replyTo ? { quoted: { ref: { id: replyTo, chatId } } } : {}),
    raw: ev,
  }
}

function toInteraction(
  ev: MessagingEvent,
  chatId: string,
  interactionId: string,
  data: string,
): InboundEvent {
  return {
    kind: 'interaction',
    interaction: {
      interactionId,
      ref: { id: interactionId, chatId, native: ev },
      chat: { id: chatId, kind: 'dm', isGroup: false, isBroadcast: false },
      senderInfo: { id: chatId },
      from: chatId, sender: chatId, chatId, senderId: chatId,
      isGroup: false,
      kind: 'button',
      data,
      timestamp: eventTime(ev.timestamp),
      raw: ev,
    },
  }
}

function toReaction(ev: MessagingEvent, chatId: string, r: Reaction): InboundEvent {
  const action = str(r.action)
  return {
    kind: 'reaction',
    reaction: {
      ref: { id: str(r.mid) ?? '', chatId, native: ev },
      // `emoji` is the character itself; `reaction` only names it ('love', 'smile'…).
      emoji: str(r.emoji) ?? str(r.reaction) ?? '',
      senderId: chatId,
      removed: action === 'unreact' || action === 'remove',
    },
  }
}

/**
 * Id for an event that carries no `mid` (opt-in, referral). Core dedupes inbound
 * events by `chatId` + id, so the id must be unique per logical event and stable
 * across redelivery: the event kind plus its webhook `timestamp` (epoch ms,
 * identical on a Meta retry) is both. Never a per-user constant (PSID,
 * `user_ref`) — that would drop every later referral/opt-in of the same user as
 * a duplicate. Without a timestamp, `''` opts the event out of deduplication.
 */
function eventScopedId(kind: 'optin' | 'referral', ev: MessagingEvent): string {
  const ts = num(ev.timestamp)
  return ts !== undefined ? `${kind}:${ts}` : ''
}

/**
 * Parse a full `page` webhook body into a flat list of events.
 *
 * A `reaction` (top-level, as Meta sends `message_reactions`, or nested in
 * `message` as older payloads did) becomes a reaction event. Inside a
 * `message`: quick_reply → attachment → text. `postback`, `opt_in` and
 * `referral` surface as `button` interactions (the payload the bot set on the
 * control, or the referral param). Delivery/read webhooks
 * (`message_deliveries`/`message_reads`) are not normalized here — use
 * `markRead`/`typing` for the outbound side.
 */
/** Epoch ms of the event (the webhook sends ms); the receive time when it is missing. */
function eventTime(v: unknown): number {
  const ts = num(v)
  return ts !== undefined && ts > 0 ? Math.round(ts) : Date.now()
}

export function parseInbound(body: PageWebhookBody, selfId?: string): InboundEvent[] {
  const events: InboundEvent[] = []
  if (rec<PageWebhookBody>(body)?.object !== 'page') return events

  for (const rawEntry of arr(body.entry)) {
    for (const rawEv of arr(rec<{ messaging?: unknown }>(rawEntry)?.messaging)) {
      const ev = rec<MessagingEvent>(rawEv)
      const chatId = str(rec<{ id?: unknown }>(ev?.sender)?.id)
      if (!ev || !chatId) continue
      const message = rec<MessengerMessage>(ev.message)

      // Echoes are the Page's OWN outbound messages replayed back to us. Their
      // `sender.id` is the Page (not the user), so keeping them would corrupt the
      // conversation key and risk an echo loop. Drop them — consistent with the
      // Instagram provider and with core's fromMe filter.
      if (message?.is_echo) continue

      const reaction = rec<Reaction>(ev.reaction) ?? rec<Reaction>(message?.reaction)
      if (reaction) {
        events.push(toReaction(ev, chatId, reaction))
        continue
      }

      if (message) {
        // Quick replies → button interactions.
        const quickReply = rec<{ payload?: unknown }>(message.quick_reply)
        if (typeof quickReply?.payload === 'string') {
          events.push(toInteraction(ev, chatId, str(message.mid) ?? '', quickReply.payload))
          continue
        }
        events.push({ kind: 'message', message: toMessage(ev, chatId, message, selfId) })
        continue
      }

      const postback = rec<NonNullable<MessagingEvent['postback']>>(ev.postback)
      if (postback) {
        events.push(toInteraction(ev, chatId, str(postback.mid) ?? '', str(postback.payload) ?? ''))
        continue
      }
      const optin = rec<NonNullable<MessagingEvent['optin']>>(ev.optin)
      if (optin) {
        events.push(toInteraction(ev, chatId, eventScopedId('optin', ev), str(optin.payload) ?? str(optin.ref) ?? ''))
        continue
      }
      const referral = rec<NonNullable<MessagingEvent['referral']>>(ev.referral)
      if (referral) {
        events.push(toInteraction(ev, chatId, eventScopedId('referral', ev), str(referral.ref) ?? ''))
      }
    }
  }
  return events
}
