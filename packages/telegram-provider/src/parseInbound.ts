/**
 * parseInbound — turn a Telegram Bot API {@link TelegramUpdate} into a
 * normalized {@link InboundEvent}.
 *
 * Identity resolution (done HERE so the core never re-derives it):
 *  - chatId   = String(message.chat.id)  (stable per chat, incl. negative group ids)
 *  - senderId = String(message.sender_chat.id) when the message was sent on
 *    behalf of a chat (its `from` is then a shared placeholder user), else
 *    String(message.from.id), else chat.id. All aliasing is collapsed before
 *    emission.
 *  - ref.id   = String(message_id); `eph:<id>` for ephemeral messages;
 *    inline_message_id for inline-mode callbacks; `upd:<update_id>` when the
 *    payload has no addressable message. Never ''. See refs.ts.
 *
 * Timestamps are emitted as epoch MILLISECONDS (Telegram sends seconds).
 */

import type {
  ChatInfo,
  InboundEvent,
  InboundLocation,
  InboundMessage,
  InboundInteraction,
  MediaRef,
  MessageRef,
  MessageType,
  SenderInfo,
} from '@botmesh/core'
import { toInboundLocation } from '@botmesh/core/spi'
import type {
  TelegramCallbackQuery,
  TelegramChat,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from './types.js'

type TelegramId = number | string

/** A usable Bot API id: a finite number or a non-empty string. */
function isId(v: unknown): v is TelegramId {
  return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v !== '')
}

/*
 * Wire values are untrusted (a forged webhook body, a future Bot API shape):
 * every field is type-checked before use, so a malformed Update is normalized
 * or skipped, never thrown at the poll loop or at the host's webhook route.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
/** A user object with a usable id, else undefined. */
const userOf = (v: unknown): TelegramUser | undefined => (isObj(v) && isId(v.id) ? (v as unknown as TelegramUser) : undefined)
/** A chat object with a usable id, else undefined. */
const chatOf = (v: unknown): TelegramChat | undefined => (isObj(v) && isId(v.id) ? (v as unknown as TelegramChat) : undefined)
interface FileFields { file_id: string; mime_type?: string; file_name?: string; file_size?: number; emoji?: string }
/** A file object with a non-empty string `file_id`, with its optional fields type-checked. */
const fileOf = (v: unknown): FileFields | undefined =>
  isObj(v) && typeof v.file_id === 'string' && v.file_id !== ''
    ? { file_id: v.file_id, mime_type: str(v.mime_type), file_name: str(v.file_name), file_size: num(v.file_size), emoji: str(v.emoji) }
    : undefined
/** Telegram dates are unix seconds; a missing/zero/invalid one becomes the receive time. */
/** Epoch ms of a Bot API date (epoch seconds); the receive time when absent or invalid. */
const secondsToMs = (v: unknown): number => {
  const ms = Math.round((num(v) ?? Number.NaN) * 1000)
  return Number.isSafeInteger(ms) && ms > 0 ? ms : Date.now()
}
const nameOf = (o: { first_name?: unknown; last_name?: unknown; username?: unknown }): string | undefined =>
  [str(o.first_name), str(o.last_name)].filter(Boolean).join(' ') || str(o.username)

function chatInfo(chat: TelegramChat): ChatInfo {
  const kind =
    chat.type === 'private' ? 'dm'
    : chat.type === 'group' || chat.type === 'supergroup' ? 'group'
    : chat.type === 'channel' ? 'channel'
    : 'dm'
  const name = str(chat.title) ?? nameOf(chat)
  return {
    id: String(chat.id),
    kind,
    name: name || undefined,
    isGroup: kind === 'group',
    isBroadcast: kind === 'channel',
    platformData: { chatType: chat.type, username: str(chat.username) },
  }
}

/** The private chat between the bot and `user` (inline-mode callbacks carry no chat). */
function userChatInfo(user: TelegramUser): ChatInfo {
  const name = nameOf(user)
  return {
    id: String(user.id),
    kind: 'dm',
    name: name || undefined,
    isGroup: false,
    isBroadcast: false,
    platformData: { chatType: 'private', username: str(user.username) },
  }
}

function senderInfo(user: TelegramUser | undefined, fallbackId: string): SenderInfo {
  if (!user || !isId(user.id)) return { id: fallbackId }
  const displayName = nameOf(user)
  return {
    id: String(user.id),
    displayName: displayName || undefined,
    username: str(user.username),
    isBot: typeof user.is_bot === 'boolean' ? user.is_bot : undefined,
    platformData: { languageCode: str(user.language_code) },
  }
}

/**
 * Who sent `msg`. A message sent on behalf of a chat (anonymous group admin,
 * linked-channel auto-forward, channel post) carries `sender_chat`; its `from`
 * is then a shared placeholder user (e.g. GroupAnonymousBot / 777000), so the
 * chat is the stable identity. Otherwise `from`, else the chat itself.
 */
function senderOf(msg: TelegramMessage, chatId: string): SenderInfo {
  const sc = chatOf(msg.sender_chat)
  if (sc) {
    const info = chatInfo(sc)
    return {
      id: info.id,
      displayName: info.name,
      username: str(sc.username),
      isBot: false,
      platformData: { senderChat: true, chatType: sc.type },
    }
  }
  return senderInfo(userOf(msg.from), chatId)
}

/**
 * The opaque ref of `msg` (encoding documented in refs.ts), or undefined when
 * the message carries no addressable id and no `updateId` fallback was given.
 */
function messageRef(msg: TelegramMessage, chatId: string, updateId?: number): MessageRef | undefined {
  const nativeChat = isObj(msg.chat) && isId(msg.chat.id) ? msg.chat.id : chatId
  if (typeof msg.ephemeral_message_id === 'number' && Number.isSafeInteger(msg.ephemeral_message_id) && msg.ephemeral_message_id > 0) {
    return { id: `eph:${msg.ephemeral_message_id}`, chatId, native: { chat_id: nativeChat, ephemeral_message_id: msg.ephemeral_message_id } }
  }
  if (typeof msg.message_id === 'number' && Number.isSafeInteger(msg.message_id) && msg.message_id > 0) {
    return { id: String(msg.message_id), chatId, native: { chat_id: nativeChat, message_id: msg.message_id } }
  }
  // No usable id: update_id is unique per Update and repeated on webhook retries.
  if (updateId != null) return { id: `upd:${updateId}`, chatId, native: { chat_id: nativeChat } }
  return undefined
}

function mediaOf(msg: TelegramMessage): { type: MessageType; body: string; media?: MediaRef; location?: InboundLocation } {
  const caption = str(msg.caption) ?? ''
  // Sizes come smallest first: take the largest well-formed one.
  const sizes = arr(msg.photo).map(fileOf).filter((f) => f !== undefined)
  if (sizes.length) {
    const last = sizes[sizes.length - 1]
    return {
      type: 'image',
      body: caption,
      media: { kind: 'image', filename: undefined, size: last.file_size, token: last.file_id },
    }
  }
  const single: Array<[keyof Pick<TelegramMessage, 'document' | 'audio' | 'voice' | 'video' | 'sticker'>, MediaRef['kind']]> = [
    ['document', 'document'],
    ['audio', 'audio'],
    ['voice', 'voice'],
    ['video', 'video'],
    ['sticker', 'sticker'],
  ]
  for (const [field, kind] of single) {
    const f = fileOf(msg[field])
    if (f) {
      return {
        type: kind,
        body: field === 'sticker' ? (f.emoji ?? caption) : caption,
        media: { kind, mimetype: f.mime_type, filename: f.file_name, size: f.file_size, token: f.file_id },
      }
    }
  }
  if (isObj(msg.venue) || isObj(msg.location)) {
    // A venue (named place) also carries `location`; prefer the venue's own fields.
    const v: Record<string, unknown> | undefined = isObj(msg.venue) ? msg.venue : undefined
    const l: Record<string, unknown> | undefined = isObj(v?.location) ? v.location : isObj(msg.location) ? msg.location : undefined
    const location = toInboundLocation({
      latitude: l?.latitude,
      longitude: l?.longitude,
      name: str(v?.title),
      address: str(v?.address),
      live: !v && typeof l?.live_period === 'number' && l.live_period > 0,
    })
    return { type: 'location', body: str(v?.title) ?? str(v?.address) ?? '', ...(location ? { location } : {}) }
  }
  if (isObj(msg.contact)) {
    const c: Record<string, unknown> = msg.contact
    return { type: 'contact', body: [str(c.first_name), str(c.last_name), str(c.phone_number)].filter(Boolean).join(' ') }
  }
  if (isObj(msg.poll)) return { type: 'poll', body: str((msg.poll as Record<string, unknown>).question) ?? '' }
  return { type: 'unknown', body: '' }
}

function mentionsOf(msg: TelegramMessage): string[] {
  const ids = new Set<string>()
  for (const list of [arr(msg.entities), arr(msg.caption_entities)]) {
    for (const e of list) {
      if (!isObj(e) || e.type !== 'text_mention') continue
      const user = userOf(e.user)
      if (user) ids.add(String(user.id))
    }
  }
  return [...ids]
}

/**
 * In groups, Telegram clients address a command to one bot as `/cmd@BotName`.
 * When the leading `bot_command` entity names THIS bot (case-insensitive), the
 * `@BotName` suffix is dropped from the body so `bot.command('cmd')` matches;
 * a command addressed to another bot is left untouched (it then never matches).
 * `raw.text` (or `raw.caption`) keeps the original. Applies to text and to media captions.
 */
function stripOwnMention(entities: unknown, text: string, botUsername?: string): string {
  if (!botUsername) return text
  const first = arr(entities)[0]
  if (!isObj(first) || first.type !== 'bot_command' || first.offset !== 0 || typeof first.length !== 'number') return text
  const command = text.slice(0, first.length)
  const at = command.indexOf('@')
  if (at < 0 || command.slice(at + 1).toLowerCase() !== botUsername.replace(/^@/, '').toLowerCase()) return text
  return command.slice(0, at) + text.slice(first.length)
}

function toMessage(msg: TelegramMessage, updateId: number, selfId?: string, botUsername?: string): InboundMessage<TelegramMessage> {
  const chat = chatInfo(msg.chat)
  const chatId = chat.id
  const sender = senderOf(msg, chatId)
  const senderId = sender.id

  let type: MessageType
  let body: string
  let media: MediaRef | undefined
  let location: InboundLocation | undefined
  if (typeof msg.text === 'string') {
    type = 'text'
    body = stripOwnMention(msg.entities, msg.text, botUsername)
  } else {
    const parsed = mediaOf(msg)
    type = parsed.type
    // A command can also open a media caption (`/menu@Bot` on a photo): same rule as text.
    body = typeof msg.caption === 'string' && parsed.body === msg.caption
      ? stripOwnMention(msg.caption_entities, parsed.body, botUsername)
      : parsed.body
    media = parsed.media
    location = parsed.location
  }

  const replyTo = isObj(msg.reply_to) && isObj(msg.reply_to.message) ? msg.reply_to.message : undefined
  const replied = replyTo ?? (isObj(msg.reply_to_message) ? msg.reply_to_message : undefined)
  const repliedSender = replied ? (chatOf(replied.sender_chat) ?? userOf(replied.from)) : undefined
  const quoted = replied
    ? {
        ref: messageRef(replied, chatId),
        body: str(replied.text) ?? str(replied.caption),
        senderId: repliedSender ? String(repliedSender.id) : undefined,
      }
    : undefined

  // updateId is passed, so messageRef always returns a ref here.
  const ref = messageRef(msg, chatId, updateId) as MessageRef
  // An edit keeps the original id (so reply/react/edit still target the message;
  // the core deduper tells the edit apart by its content) and carries edit_date.
  if (num(msg.edit_date) !== undefined && ref.native && typeof ref.native === 'object') {
    ref.native = { ...(ref.native as Record<string, unknown>), edit_date: msg.edit_date }
  }

  return {
    ref,
    chat,
    senderInfo: sender,
    from: chatId,
    sender: senderId,
    chatId,
    senderId,
    isGroup: chat.isGroup,
    isBroadcast: chat.isBroadcast,
    fromMe: selfId != null && senderId === selfId,
    type,
    body,
    timestamp: secondsToMs(msg.date),
    mentions: mentionsOf(msg),
    quoted,
    media,
    ...(location ? { location } : {}),
    raw: msg,
  }
}

/**
 * callback_query -> interaction. Three shapes per the Bot API:
 *  - `message` (possibly an InaccessibleMessage: chat + message_id, date 0):
 *    the button's own chat/message;
 *  - `inline_message_id` (button on a message sent via the bot in inline
 *    mode): no chat is known, so the presser's private chat with the bot
 *    (`from.id`) is used and the ref carries `native.inline_message_id`, which
 *    editMessage turns into editMessageText({ inline_message_id }). Sending to
 *    that chat fails (RecipientUnreachableError) if the user never started the
 *    bot; acknowledgeInteraction (answerCallbackQuery) always works;
 *  - neither (not expected; defensive): user chat + `upd:<update_id>` ref.
 * The Bot API sends no press time: `timestamp` is the receive time (the epoch ms
 * when the update arrived), not the date of the message that carries the keyboard.
 */
function toInteraction(cb: TelegramCallbackQuery, updateId: number): InboundInteraction<TelegramCallbackQuery> | undefined {
  const from = userOf(cb.from)
  if (typeof cb.id !== 'string' || cb.id === '' || !from) return undefined
  const msg = isObj(cb.message) && chatOf(cb.message.chat) ? cb.message : undefined
  const chat = msg ? chatInfo(msg.chat) : userChatInfo(from)
  let ref: MessageRef
  if (msg) {
    ref = messageRef(msg, chat.id, updateId) as MessageRef
  } else if (typeof cb.inline_message_id === 'string' && cb.inline_message_id !== '') {
    ref = { id: cb.inline_message_id, chatId: chat.id, native: { inline_message_id: cb.inline_message_id } }
  } else {
    ref = { id: `upd:${updateId}`, chatId: chat.id }
  }
  const sender = senderInfo(from, chat.id)
  return {
    interactionId: cb.id,
    ref,
    chat,
    senderInfo: sender,
    from: chat.id,
    sender: sender.id,
    chatId: chat.id,
    senderId: sender.id,
    isGroup: chat.isGroup,
    kind: 'button',
    data: str(cb.data) ?? '',
    timestamp: Date.now(),
    raw: cb,
  }
}

/**
 * Whether `message` (emitted by this provider) is an edit of an earlier message
 * (an `edited_message` update). An edit keeps the original `ref.id`, so
 * `ctx.reply`/`ctx.react`/`ctx.edit` target the edited message; its `body` is
 * the new text and `raw.edit_date` (seconds) is when it was edited.
 *
 * @example
 * ```ts
 * bot.on('message', (m) => { if (isEditedMessage(m)) audit.log('edited', m.ref.id) })
 * ```
 */
export function isEditedMessage(message: { raw?: unknown }): boolean {
  const raw = message.raw
  return typeof raw === 'object' && raw !== null && typeof (raw as { edit_date?: unknown }).edit_date === 'number'
}

/**
 * Normalize one Update. Returns undefined for update kinds this provider does
 * not surface (channel_post / edited_channel_post, business_message /
 * edited_business_message (replying needs business_connection_id),
 * guest_message (answered via answerGuestQuery), my_chat_member,
 * pre_checkout, poll updates...) and for malformed payloads that lack the ids
 * needed to route them (no chat id; no callback id or sender). Never emits an
 * event with an empty chatId, senderId or ref.id.
 */
export function parseUpdate(update: TelegramUpdate, selfId?: string, botUsername?: string): InboundEvent | undefined {
  if (!isObj(update)) return undefined
  const msg = isObj(update.message) ? update.message : isObj(update.edited_message) ? update.edited_message : undefined
  if (msg) {
    if (!chatOf(msg.chat)) return undefined
    return { kind: 'message', message: toMessage(msg, update.update_id, selfId, botUsername) }
  }
  if (isObj(update.callback_query)) {
    const interaction = toInteraction(update.callback_query, update.update_id)
    return interaction ? { kind: 'interaction', interaction } : undefined
  }
  return undefined
}
