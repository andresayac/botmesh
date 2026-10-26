/**
 * @botmesh/telegram — config + Telegram Bot API wire types (subset used).
 *
 * Shapes are deliberately loose (optional fields everywhere): the Bot API is
 * additive and we only read what the normalizer needs.
 */

import type { SecureFetchOptions } from '@botmesh/http'
import type { LoggerLike } from '@botmesh/core'

export interface TelegramProviderConfig {
  /** Bot token from @BotFather. */
  token: string
  /**
   * Bot API base URL. Default 'https://api.telegram.org'. Point it at a
   * self-hosted Bot API server (`telegram-bot-api`) to lift the 20 MB download
   * / 50 MB upload limits; when that server runs on a private address
   * (localhost, Docker network, LAN) also set `mediaDownload.allowPrivateHosts`
   * so file downloads are not refused by the anti-SSRF guard.
   */
  baseUrl?: string
  /**
   * Safe-download policy for Telegram file URLs (`@botmesh/http` `secureFetch`
   * options: `maxBytes`, `timeoutMs`, `allowPrivateHosts`, ...). Downloads are
   * refused for private/loopback hosts unless `allowPrivateHosts: true`, which a
   * self-hosted Bot API server on a private network needs.
   */
  mediaDownload?: Omit<SecureFetchOptions, 'fetch'>
  /**
   * What to do with `edited_message` updates (a user edits a message the bot
   * already saw):
   *  - `'deliver'` (default): emit it as a normal message with the new text. It
   *    keeps the original `ref.id` (reply/react/edit target the edited message),
   *    `ref.native.edit_date` / `raw.edit_date` are set, and `isEditedMessage()`
   *    returns true. The core deduper lets it through because its content
   *    differs; a redelivery of the same edit (or an edit that leaves the text
   *    unchanged) is dropped.
   *  - `'ignore'`: edits are not requested from `getUpdates` and are dropped in
   *    webhook mode (also unsubscribe them in `setWebhook`'s `allowed_updates`).
   */
  editedMessages?: 'deliver' | 'ignore'
  /**
   * Send polls as anonymous Telegram polls. Default `false`: polls are sent
   * with `is_anonymous: false` so each vote reaches the bot as a `poll_answer`
   * update and becomes a `'poll'` event (`bot.on('poll')`), like on WhatsApp.
   * Members of the chat can then see who voted. Channels refuse public-voter
   * polls: a poll to a channel is retried once as anonymous (no votes) and that
   * channel gets anonymous polls from then on. `true` sends anonymous polls,
   * whose votes the bot never receives. A per-send
   * `platformData: { is_anonymous }` overrides it.
   */
  anonymousPolls?: boolean
  /**
   * true (default): start() runs a getUpdates long-poll loop.
   * false: webhook mode — the host POSTs Updates to `ingest()`.
   */
  polling?: boolean
  /** The bot's own user id (numeric, as string). If omitted, resolved via getMe. */
  selfId?: string
  /**
   * The bot's @username (with or without the `@`). Learned from getMe when
   * `selfId` is omitted; set it when you pass `selfId`. Used to turn a group
   * command addressed to this bot (`/menu@MyBot`) into `/menu` so
   * `bot.command('menu')` matches.
   */
  username?: string
  /**
   * Secret token for webhook mode. Set the SAME value in Telegram's `setWebhook`
   * (`secret_token`) and here; `ingest()` then rejects any request whose
   * `X-Telegram-Bot-Api-Secret-Token` header does not match (401). Without it,
   * ANY caller who discovers the webhook URL can inject forged Updates.
   * Strongly recommended in webhook mode.
  */
  webhookSecret?: string
  /** Explicit local-development escape hatch for unsigned webhook mode. */
  allowUnsignedWebhooks?: boolean
  /**
   * Long-poll server timeout in ms (getUpdates `timeout`, sent in whole seconds,
   * rounded up). Default 30000.
   */
  pollTimeoutMs?: number
  /**
   * Long-poll server timeout in seconds. Default 30.
   *
   * @deprecated Use `pollTimeoutMs` (milliseconds, like every other duration
   * option). Removal planned for v3.
   */
  pollTimeout?: number
  /** Base backoff (ms) after a failed getUpdates round. Grows exponentially per consecutive failure. Default 1000. */
  errorBackoffMs?: number
  /** Ceiling (ms) for the exponential getUpdates error backoff. Default 60000. */
  maxBackoffMs?: number
  /** Pause (ms) after an empty getUpdates batch. Default 250 (server long-poll already waited). */
  pollIdleMs?: number
  /**
   * Client-side timeout (ms) for each Bot API request. A request that takes longer
   * rejects with a `ProviderError` ("timed out"). Long polls get `pollTimeout`
   * seconds plus up to 15 s of grace instead, so a half-open connection never stalls
   * the poll loop. Uploads use `uploadTimeoutMs`. Default 120000.
   */
  requestTimeoutMs?: number
  /**
   * Client-side timeout (ms) for a request that uploads a file (multipart). Default
   * 300000 (5 minutes), or `requestTimeoutMs` when that is larger. Raise it for very
   * large uploads to a self-hosted Bot API server.
   */
  uploadTimeoutMs?: number
  /**
   * @deprecated Pass a `logger` (any `LoggerLike`, e.g. `pino({ level: 'debug' })`)
   * instead. Removal planned for v3.
   */
  debug?: boolean
  logger?: LoggerLike
}

/* --- Bot API envelopes ---------------------------------------------------- */

export interface TelegramResponse<T> {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}

/* --- Bot API domain objects (subset) -------------------------------------- */

export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel' | string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramPhotoSize {
  file_id: string
  file_unique_id?: string
  width?: number
  height?: number
  file_size?: number
}

export interface TelegramFile {
  file_id: string
  file_unique_id?: string
  file_size?: number
  file_path?: string
  mime_type?: string
  file_name?: string
  /** Sticker-only extra, surfaced on platformData. */
  emoji?: string
}

export interface TelegramLocation {
  latitude: number
  longitude: number
  /** Seconds the location can be updated for: present on a live-location share. */
  live_period?: number
  horizontal_accuracy?: number
}

/** A named place (`message.venue`); Telegram also sets `message.location` on it. */
export interface TelegramVenue {
  location: TelegramLocation
  title?: string
  address?: string
}

export interface TelegramContact {
  phone_number: string
  first_name?: string
  last_name?: string
  user_id?: number
}

export interface TelegramPoll {
  id: string
  question: string
  options: Array<{ text: string; voter_count?: number }>
  allows_multiple_answers?: boolean
  type?: 'regular' | 'quiz'
}

export interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  user?: TelegramUser
}

export interface TelegramMessage {
  /** Unique per chat; always 0 for ephemeral messages (Bot API 10.2) — see `ephemeral_message_id`. */
  message_id: number
  /** Bot API 10.2: id of an ephemeral message inside its chat (message_id is then 0). */
  ephemeral_message_id?: number
  /** Set on business_message / edited_business_message updates. */
  business_connection_id?: string
  message_thread_id?: number
  from?: TelegramUser
  sender_chat?: TelegramChat
  date?: number
  /** Set on edited_message updates: when the message was last edited (unix seconds). */
  edit_date?: number
  chat: TelegramChat
  text?: string
  caption?: string
  entities?: TelegramMessageEntity[]
  caption_entities?: TelegramMessageEntity[]
  photo?: TelegramPhotoSize[]
  document?: TelegramFile
  audio?: TelegramFile
  voice?: TelegramFile
  video?: TelegramFile
  sticker?: TelegramFile
  location?: TelegramLocation
  venue?: TelegramVenue
  contact?: TelegramContact
  poll?: TelegramPoll
  /** Legacy (Bot API < 7.0) reply reference. */
  reply_to_message?: TelegramMessage
  /** Bot API 7+: `reply_to.message` carries the quoted message. */
  reply_to?: { message?: TelegramMessage }
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  /**
   * Present when the button was on a message sent by the bot. May be an
   * InaccessibleMessage (only chat + message_id, `date` always 0).
   */
  message?: TelegramMessage
  /** Present instead of `message` for buttons on messages sent via the bot in inline mode. */
  inline_message_id?: string
  chat_instance?: string
  data?: string
  game_short_name?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
  edited_channel_post?: TelegramMessage
  business_message?: TelegramMessage
  edited_business_message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
  poll_answer?: TelegramPollAnswer
  [key: string]: unknown
}

/** A vote in a non-anonymous poll (`poll_answer` update). `option_ids` is empty when the vote was retracted. */
export interface TelegramPollAnswer {
  poll_id: string
  /** Set when the vote was cast on behalf of a chat (anonymous admin). */
  voter_chat?: TelegramChat
  user?: TelegramUser
  option_ids: number[]
}
