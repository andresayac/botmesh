/**
 * parseInbound — turn Discord gateway DISPATCH frames into normalized
 * {@link InboundEvent}s. Identity is the Discord user snowflake (`author.id` /
 * `member.user.id`): stable, no member-vs-user aliasing leaks out.
 *
 *   MESSAGE_CREATE     → kind 'message'   (bots and system messages are ignored)
 *   MESSAGE_UPDATE     → kind 'message' for an edit (`edited_timestamp` set), keeping
 *                        the original `ref.id`; other updates (embed unfurls…) are ignored
 *   INTERACTION_CREATE → kind 'interaction' (button / select / slash command)
 *
 * Frames are read defensively: a field of the wrong type is ignored, so a
 * malformed frame yields no event (or a poorer one), never a throw or an event
 * with non-string ids.
 */

import type {
  InboundEvent,
  InboundInteraction,
  InboundMessage,
  MediaRef,
  MessageType,
} from '@botmesh/core'
import {
  ComponentType,
  InteractionType,
  type DiscordAttachment,
  type DiscordInteractionPayload,
  type DiscordMessagePayload,
  type DiscordUser,
} from './types.js'

const DISCORD_EPOCH = 1_420_070_400_000n

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const rec = <T extends object>(v: unknown): T | undefined =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * Message types a person authors: DEFAULT (0) and REPLY (19). Everything else
 * (member joins, pins, boosts, thread notices…) is a system message.
 */
const USER_MESSAGE_TYPES = new Set<unknown>([0, 19])

/** Epoch ms encoded in a snowflake id (Discord's timestamp extraction). */
export function snowflakeTimestamp(id: string): number {
  try {
    const ms = Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
    return Number.isFinite(ms) ? ms : Date.now()
  } catch {
    return Date.now()
  }
}

/** Parse one DISPATCH frame; undefined for events we don't normalize. */
export function parseDispatch(t: string, d: unknown, selfId?: string | null): InboundEvent | undefined {
  switch (t) {
    case 'MESSAGE_CREATE':
      return parseMessageCreate(rec<DiscordMessagePayload>(d), selfId)
    case 'MESSAGE_UPDATE': {
      // Only a content edit carries `edited_timestamp`; embed unfurls and other
      // partial updates do not, and are not new input.
      const m = rec<DiscordMessagePayload>(d)
      return m && typeof m.edited_timestamp === 'string' ? parseMessageCreate(m, selfId) : undefined
    }
    case 'INTERACTION_CREATE':
      return parseInteractionCreate(rec<DiscordInteractionPayload>(d))
    default:
      return undefined
  }
}

/**
 * Whether `message` (emitted by this provider) is an edit of an earlier message
 * (a `MESSAGE_UPDATE` with `edited_timestamp`). An edit keeps the original
 * `ref.id`, so `ctx.reply`/`ctx.react` target the edited message; its `body` is
 * the new text and `raw.edited_timestamp` (ISO 8601) is when it was edited.
 */
export function isEditedMessage(message: { raw?: unknown }): boolean {
  const raw = message.raw
  return typeof raw === 'object' && raw !== null && typeof (raw as { edited_timestamp?: unknown }).edited_timestamp === 'string'
}

/* --- MESSAGE_CREATE -------------------------------------------------------- */

/** `message_reference.type` of a forward (0 / absent is a reply). */
const REFERENCE_FORWARD = 1

const isForward = (d: DiscordMessagePayload): boolean =>
  rec<{ type?: unknown }>(d.message_reference)?.type === REFERENCE_FORWARD

function describeContent(d: DiscordMessagePayload): { type: MessageType; body: string; media?: MediaRef } {
  const poll = rec<NonNullable<DiscordMessagePayload['poll']>>(d.poll)
  if (poll) return { type: 'poll', body: str(rec<{ text?: unknown }>(poll.question)?.text) ?? '' }
  if (isForward(d)) {
    // A forward has an empty `content`: the text and files are in the snapshot.
    const snapshot = rec<DiscordMessagePayload>(rec<{ message?: unknown }>(arr(d.message_snapshots)[0])?.message)
    const described = describeAttachment(snapshot ?? {})
    // Nothing readable (embeds, stickers…): never an empty text, which would
    // answer an ask() or trigger WELCOME.
    return described.type === 'text' && described.body === '' ? { type: 'unknown', body: '' } : described
  }
  return describeAttachment(d)
}

function describeAttachment(
  d: Pick<DiscordMessagePayload, 'content' | 'attachments'>,
): { type: MessageType; body: string; media?: MediaRef } {
  const body = typeof d.content === 'string' ? d.content : ''
  const att = rec<DiscordAttachment>(arr(d.attachments)[0])
  if (!att) return { type: 'text', body }
  const mime = str(att.content_type) ?? ''
  const type: MessageType =
    mime.startsWith('image/') ? 'image'
    : mime.startsWith('video/') ? 'video'
    : mime.startsWith('audio/') ? 'audio'
    : 'document'
  return {
    type,
    body,
    media: {
      kind: type as MediaRef['kind'],
      mimetype: str(att.content_type),
      filename: str(att.filename),
      size: typeof att.size === 'number' && Number.isFinite(att.size) && att.size > 0 ? att.size : undefined,
      token: str(att.url),
    },
  }
}

/** ISO `timestamp` of the message, else the time encoded in its snowflake id. */
function messageTimestamp(d: DiscordMessagePayload, id: string): number {
  const parsed = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : NaN
  return Number.isFinite(parsed) ? parsed : snowflakeTimestamp(id)
}

function parseMessageCreate(d: DiscordMessagePayload | undefined, selfId?: string | null): InboundEvent | undefined {
  const author = rec<DiscordUser>(d?.author)
  const authorId = str(author?.id)
  const id = str(d?.id)
  const chatId = str(d?.channel_id)
  if (!d || !author || !authorId || !id || !chatId) return undefined
  if (author.bot) return undefined // ignore own + other bots
  if (d.type !== undefined && !USER_MESSAGE_TYPES.has(d.type)) return undefined // system message

  const guildId = str(d.guild_id)
  const isGroup = guildId !== undefined
  const { type, body, media } = describeContent(d)
  const member = rec<{ nick?: unknown }>(d.member)

  const message: InboundMessage<DiscordMessagePayload> = {
    ref: { id, chatId, native: d },
    chat: {
      id: chatId,
      kind: isGroup ? 'group' : 'dm',
      isGroup,
      isBroadcast: false,
      ...(guildId ? { platformData: { guildId } } : {}),
    },
    senderInfo: {
      id: authorId,
      username: str(author.username),
      displayName: str(member?.nick) ?? str(author.global_name) ?? str(author.username),
      isBot: false,
    },
    from: chatId,
    sender: authorId,
    chatId,
    senderId: authorId,
    isGroup,
    isBroadcast: false,
    fromMe: Boolean(selfId && authorId === selfId),
    type,
    body,
    timestamp: messageTimestamp(d, id),
    mentions: arr(d.mentions).map((m) => str(rec<DiscordUser>(m)?.id)).filter((m): m is string => m !== undefined),
    media,
    raw: d,
  }

  const reference = rec<NonNullable<DiscordMessagePayload['message_reference']>>(d.message_reference)
  const quotedId = str(reference?.message_id)
  if (quotedId && !isForward(d)) {
    const referenced = rec<DiscordMessagePayload>(d.referenced_message)
    message.quoted = {
      ref: { id: quotedId, chatId: str(reference?.channel_id) ?? chatId },
      body: typeof referenced?.content === 'string' ? referenced.content : undefined,
      senderId: str(rec<DiscordUser>(referenced?.author)?.id),
    }
  }

  return { kind: 'message', message }
}

/* --- INTERACTION_CREATE ---------------------------------------------------- */

function parseInteractionCreate(d: DiscordInteractionPayload | undefined): InboundEvent | undefined {
  const id = str(d?.id)
  const token = str(d?.token)
  if (!d || !id || !token) return undefined
  const user = rec<DiscordUser>(rec<{ user?: unknown }>(d.member)?.user) ?? rec<DiscordUser>(d.user)
  const userId = str(user?.id)
  if (!user || !userId || user.bot) return undefined

  // Newer payloads also carry the partial `channel` object; without either
  // there is no chat to route to (never emit an empty chatId).
  const chatId = str(d.channel_id) ?? str(rec<{ id?: unknown }>(d.channel)?.id)
  if (!chatId) return undefined
  const isGroup = str(d.guild_id) !== undefined
  const timestamp = snowflakeTimestamp(id)
  const data = rec<NonNullable<DiscordInteractionPayload['data']>>(d.data)

  let kind: InboundInteraction['kind']
  let value: string | undefined
  switch (d.type) {
    case InteractionType.ApplicationCommand:
      kind = 'command'
      value = str(data?.name)
      break
    case InteractionType.MessageComponent:
      if (data?.component_type === ComponentType.StringSelect) {
        // A choose()/list menu answers with the selected option value (the row id).
        kind = 'list'
        value = str(arr(data.values)[0]) ?? str(data.custom_id)
      } else {
        kind = 'button'
        value = str(data?.custom_id)
      }
      break
    case InteractionType.ModalSubmit:
      kind = 'modal'
      value = str(data?.custom_id)
      break
    case InteractionType.ApplicationCommandAutocomplete:
      kind = 'autocomplete'
      value = str(data?.name)
      break
    default:
      return undefined // Ping etc. — internal to the gateway/REST layer
  }
  const member = rec<{ nick?: unknown }>(d.member)
  // The token lets anyone answer as the bot for 15 minutes: it never leaves the
  // provider (which remembers it by interaction id), so it is not in raw/native.
  const { token: _token, ...safe } = d

  const interaction: InboundInteraction<Omit<DiscordInteractionPayload, 'token'>> = {
    // The interaction id (a snowflake); acknowledgeInteraction looks its token up.
    interactionId: id,
    ref: { id: str(rec<{ id?: unknown }>(d.message)?.id) ?? id, chatId, native: safe },
    chat: { id: chatId, kind: isGroup ? 'group' : 'dm', isGroup, isBroadcast: false },
    senderInfo: {
      id: userId,
      username: str(user.username),
      displayName: str(member?.nick) ?? str(user.global_name) ?? str(user.username),
      isBot: false,
    },
    from: chatId,
    sender: userId,
    chatId,
    senderId: userId,
    isGroup,
    kind,
    data: value ?? '',
    // Discord requires an interaction response within ~3s.
    respondBy: timestamp + 3_000,
    timestamp,
    raw: safe,
  }
  return { kind: 'interaction', interaction }
}
