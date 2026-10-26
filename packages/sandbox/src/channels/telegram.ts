/**
 * Telegram Bot API simulator. Implements `POST /bot{token}/{method}` (JSON or
 * multipart) for the methods `@botmesh/telegram` calls, `getUpdates` long
 * polling, `setWebhook` / `deleteWebhook`, file downloads
 * (`/file/bot{token}/{path}`), and delivers Updates either through the poll
 * queue or as webhook POSTs with `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Parameters and limits follow the Bot API reference: text 1–4096, caption
 * ≤ 1024, `callback_data` 1–64 bytes, polls with 2–10 options of ≤ 100 chars,
 * answers as `{ ok, result }` or `{ ok: false, error_code, description,
 * parameters: { retry_after } }`.
 */

import {
  PlatformSimulator,
  ids,
  type BaseSimulatorOptions,
  type FaultKind,
  type MessageStatus,
  type OutboundRecord,
  type PreparedInbound,
  type SendOutcome,
  type UserInput,
} from '../sim/base.js'
import type { SimRequest, SimResponse } from '../sim/http.js'
import { KIND_MIME, type StoredMedia } from '../sim/media.js'
import { validate, type Schema } from '../sim/validate.js'

export interface TelegramSimulatorOptions extends BaseSimulatorOptions {
  token?: string
  botId?: number
  botUsername?: string
  /** Secret token sent on webhook deliveries (the bot's `webhookSecret`). */
  webhookSecret?: string
}

const button: Schema = {
  type: 'object', required: ['text'],
  properties: { text: { type: 'string', minLength: 1 }, callback_data: { type: 'string', minLength: 1 }, url: { type: 'string' } },
}
const replyMarkup: Schema = {
  type: 'object',
  properties: { inline_keyboard: { type: 'array', maxItems: 100, items: { type: 'array', minItems: 1, maxItems: 8, items: button } } },
}
const chatId: Schema = { type: ['integer', 'string'] }
const media: Schema = { type: 'string', minLength: 1 }

/** Per-method parameter shapes (Bot API reference). */
export const TELEGRAM_METHOD_SCHEMAS: Record<string, Schema> = {
  sendMessage: { type: 'object', required: ['chat_id', 'text'], properties: { chat_id: chatId, text: { type: 'string', minLength: 1, maxLength: 4096 }, reply_markup: replyMarkup, parse_mode: { enum: ['HTML', 'Markdown', 'MarkdownV2'] } } },
  sendPhoto: { type: 'object', required: ['chat_id', 'photo'], properties: { chat_id: chatId, photo: media, caption: { type: 'string', maxLength: 1024 }, reply_markup: replyMarkup } },
  sendVideo: { type: 'object', required: ['chat_id', 'video'], properties: { chat_id: chatId, video: media, caption: { type: 'string', maxLength: 1024 } } },
  sendAudio: { type: 'object', required: ['chat_id', 'audio'], properties: { chat_id: chatId, audio: media, caption: { type: 'string', maxLength: 1024 } } },
  sendVoice: { type: 'object', required: ['chat_id', 'voice'], properties: { chat_id: chatId, voice: media, caption: { type: 'string', maxLength: 1024 } } },
  sendDocument: { type: 'object', required: ['chat_id', 'document'], properties: { chat_id: chatId, document: media, caption: { type: 'string', maxLength: 1024 } } },
  sendSticker: { type: 'object', required: ['chat_id', 'sticker'], properties: { chat_id: chatId, sticker: media } },
  sendLocation: { type: 'object', required: ['chat_id', 'latitude', 'longitude'], properties: { chat_id: chatId, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } } },
  sendVenue: { type: 'object', required: ['chat_id', 'latitude', 'longitude', 'title', 'address'], properties: { chat_id: chatId, latitude: { type: 'number' }, longitude: { type: 'number' }, title: { type: 'string' }, address: { type: 'string' } } },
  sendContact: { type: 'object', required: ['chat_id', 'phone_number', 'first_name'], properties: { chat_id: chatId, phone_number: { type: 'string' }, first_name: { type: 'string', minLength: 1 } } },
  sendPoll: {
    type: 'object', required: ['chat_id', 'question', 'options'],
    properties: {
      chat_id: chatId,
      question: { type: 'string', minLength: 1, maxLength: 300 },
      options: { type: 'array', minItems: 2, maxItems: 10, items: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 100 } } }] } },
      is_anonymous: { type: 'boolean' },
      allows_multiple_answers: { type: 'boolean' },
    },
  },
  sendChatAction: { type: 'object', required: ['chat_id', 'action'], properties: { chat_id: chatId, action: { enum: ['typing', 'upload_photo', 'record_video', 'upload_video', 'record_voice', 'upload_voice', 'upload_document', 'choose_sticker', 'find_location', 'record_video_note', 'upload_video_note'] } } },
  answerCallbackQuery: { type: 'object', required: ['callback_query_id'], properties: { callback_query_id: { type: 'string' }, text: { type: 'string', maxLength: 200 }, show_alert: { type: 'boolean' } } },
  editMessageText: { type: 'object', required: ['text'], properties: { chat_id: chatId, message_id: { type: 'integer' }, inline_message_id: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 4096 }, reply_markup: replyMarkup } },
  deleteMessage: { type: 'object', required: ['chat_id', 'message_id'], properties: { chat_id: chatId, message_id: { type: 'integer' } } },
  setMessageReaction: { type: 'object', required: ['chat_id', 'message_id'], properties: { chat_id: chatId, message_id: { type: 'integer' }, reaction: { type: 'array' } } },
  getFile: { type: 'object', required: ['file_id'], properties: { file_id: { type: 'string', minLength: 1 } } },
  getUpdates: { type: 'object', properties: { offset: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, timeout: { type: 'integer', minimum: 0 }, allowed_updates: { type: 'array', items: { type: 'string' } } } },
  setWebhook: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, secret_token: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,256}$' } } },
  sendMessageDraft: { type: 'object', required: ['chat_id', 'draft_id', 'text'], properties: { chat_id: chatId, draft_id: { type: 'integer' }, text: { type: 'string', maxLength: 4096 } } },
}

const SEND_METHODS = new Set(['sendMessage', 'sendPhoto', 'sendVideo', 'sendAudio', 'sendVoice', 'sendDocument', 'sendSticker', 'sendLocation', 'sendVenue', 'sendContact', 'sendPoll', 'editMessageText'])
const MEDIA_FIELD: Record<string, OutboundRecord['kind']> = { photo: 'image', video: 'video', audio: 'audio', voice: 'voice', document: 'document', sticker: 'sticker' }

function ok(result: unknown): SimResponse {
  return { status: 200, body: { ok: true, result } }
}

function fail(code: number, description: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): SimResponse {
  return { status: code, headers, body: { ok: false, error_code: code, description, ...extra } }
}

export class TelegramSimulator extends PlatformSimulator {
  readonly channel = 'telegram' as const
  override readonly nativePollVotes = true
  readonly title = 'Telegram'
  readonly token: string
  readonly botId: number
  readonly botUsername: string
  readonly webhookSecret: string
  private updateId = 100_000
  private messageId = 1
  private readonly queue: Array<{ update_id: number; [k: string]: unknown }> = []
  private readonly waiters = new Set<() => void>()
  /** Secret from the last `setWebhook` call (wins over the configured one). */
  private apiSecret: string | undefined
  /** chat id → messages the bot sent (for callback_query.message). */
  private readonly sentMessages = new Map<string, Record<string, unknown>>()
  private readonly fileIds = new Map<string, { id: string; path: string }>()

  constructor(options: TelegramSimulatorOptions = {}) {
    super(options, { id: '123456789', name: 'Sandbox' })
    this.token = options.token ?? '7000000001:AAsandbox-telegram-bot-token_0123456'
    this.botId = options.botId ?? Number(this.token.split(':')[0]) ?? 7000000001
    this.botUsername = options.botUsername ?? 'sandbox_bot'
    this.webhookSecret = options.webhookSecret ?? 'sandbox-telegram-secret'
  }

  /** Config for `new TelegramProvider(...)`: polling by default, or webhook mode with the secret. */
  providerConfig(mode: 'polling' | 'webhook' = 'polling'): { token: string; baseUrl: string; polling: boolean; webhookSecret?: string; pollTimeout: number; mediaDownload: { allowHttp: true; allowPrivateHosts: true } } {
    return {
      token: this.token,
      baseUrl: this.url,
      polling: mode === 'polling',
      ...(mode === 'webhook' ? { webhookSecret: this.webhookSecret } : {}),
      pollTimeout: 1,
      mediaDownload: { allowHttp: true, allowPrivateHosts: true },
    }
  }

  /** Updates waiting for `getUpdates`. */
  get pending(): number {
    return this.queue.length
  }

  protected routes(): void {
    this.api('GET', '/file/:bot/*', (req) => {
      if (req.params['bot'] !== `bot${this.token}`) return { status: 404, body: { ok: false, error_code: 404, description: 'Not Found' } }
      const path = req.params['*'] ?? ''
      const entry = [...this.fileIds.values()].find((f) => f.path === path)
      const item = entry ? this.media.get(entry.id) : undefined
      if (!item) return { status: 404, body: { ok: false, error_code: 404, description: 'Not Found: file expired' } }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    this.api('*', '/:bot/:method', (req) => this.onMethod(req), {
      send: (req) => SEND_METHODS.has(req.params['method'] ?? ''),
      auth: (req) => req.params['bot'] === `bot${this.token}`,
      check: async (req) => {
        const schema = TELEGRAM_METHOD_SCHEMAS[req.params['method']!]
        if (!schema) return []
        const params = Object.fromEntries(Object.entries(await this.params(req)).map(([k, v]) => [k, v && typeof v === 'object' && (v as { __file?: boolean }).__file ? 'attach://upload' : v]))
        const issues = validate(schema, params)
        const markup = params['reply_markup'] as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined
        for (const row of markup?.inline_keyboard ?? []) {
          for (const b of row) if (b.callback_data !== undefined && Buffer.byteLength(b.callback_data) > 64) issues.push('$.reply_markup: callback_data longer than 64 bytes')
        }
        return issues
      },
    })
  }

  /** JSON body, form or multipart (JSON-encoded object fields are decoded). */
  private async params(req: SimRequest): Promise<Record<string, unknown>> {
    const ct = req.header('content-type') ?? ''
    if (ct.startsWith('multipart/form-data')) {
      const form = await req.multipart()
      const out: Record<string, unknown> = {}
      for (const [k, v] of form) {
        if (v instanceof Blob) out[k] = { __file: true, name: (v as File).name, type: v.type, data: Buffer.from(await v.arrayBuffer()) }
        else out[k] = /^[[{]/.test(v) ? safeJson(v) : /^-?\d+$/.test(v) && k !== 'text' && k !== 'caption' ? Number(v) : v
      }
      return out
    }
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(req.form())
    if (req.body.length === 0) return Object.fromEntries(req.query)
    return (req.json() as Record<string, unknown>) ?? {}
  }

  private async onMethod(req: SimRequest): Promise<SimResponse> {
    const method = req.params['method']!
    const p = await this.params(req)
    switch (method) {
      case 'getMe':
        return ok({ id: this.botId, is_bot: true, first_name: 'Sandbox Bot', username: this.botUsername, can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false })
      case 'getUpdates':
        return this.getUpdates(p)
      case 'setWebhook':
        this.webhookUrl = String(p['url'])
        this.apiSecret = typeof p['secret_token'] === 'string' ? p['secret_token'] : undefined
        return ok(true)
      case 'deleteWebhook':
        this.webhookUrl = undefined
        if (p['drop_pending_updates']) this.queue.length = 0
        return ok(true)
      case 'getWebhookInfo':
        return ok({ url: this.webhookUrl ?? '', has_custom_certificate: false, pending_update_count: this.queue.length })
      case 'getFile': {
        const fileId = String(p['file_id'])
        const entry = this.fileIds.get(fileId)
        const item = entry ? this.media.peek(entry.id) : undefined
        if (!entry || !item) return fail(400, 'Bad Request: invalid file_id')
        return ok({ file_id: fileId, file_unique_id: entry.id.slice(0, 15), file_size: item.data.length, file_path: entry.path })
      }
      case 'sendChatAction':
        this.recordOutbound({ id: '', chatId: String(p['chat_id']), kind: 'action', action: String(p['action']), raw: p })
        return ok(true)
      case 'answerCallbackQuery':
        this.recordOutbound({ id: '', chatId: '', kind: 'action', action: 'answer_callback_query', targetId: String(p['callback_query_id']), ...(typeof p['text'] === 'string' ? { text: p['text'] } : {}), raw: p })
        return ok(true)
      case 'deleteMessage':
        this.recordOutbound({ id: '', chatId: String(p['chat_id']), kind: 'delete', targetId: String(p['message_id']), raw: p })
        return ok(true)
      case 'setMessageReaction': {
        const r = (p['reaction'] as Array<{ emoji?: string }> | undefined)?.[0]
        this.recordOutbound({ id: '', chatId: String(p['chat_id']), kind: 'reaction', text: r?.emoji ?? '', targetId: String(p['message_id']), raw: p })
        return ok(true)
      }
      case 'editMessageText': {
        const chat = String(p['chat_id'])
        this.recordOutbound({ id: '', chatId: chat, kind: 'edit', text: String(p['text']), targetId: String(p['message_id']), raw: p })
        return ok({ ...this.messageBase(chat, Number(p['message_id'])), text: p['text'], edit_date: Math.floor(Date.now() / 1000) })
      }
      case 'sendMessageDraft':
        this.recordOutbound({ id: '', chatId: String(p['chat_id']), kind: 'action', action: 'draft', text: String(p['text']), raw: p })
        return ok(true)
      default:
        if (method.startsWith('send')) return this.onSend(method, p)
        return fail(404, 'Not Found: method not found')
    }
  }

  private messageBase(chat: string, messageId: number): Record<string, unknown> {
    return {
      message_id: messageId,
      from: { id: this.botId, is_bot: true, first_name: 'Sandbox Bot', username: this.botUsername },
      chat: { id: Number(chat), first_name: this.defaultUser.name, type: 'private' },
      date: Math.floor(Date.now() / 1000),
    }
  }

  private onSend(method: string, p: Record<string, unknown>): SimResponse {
    const chat = String(p['chat_id'])
    const messageId = this.messageId++
    const id = String(messageId)
    const msg: Record<string, unknown> = { ...this.messageBase(chat, messageId) }
    const markup = p['reply_markup'] as { inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> } | undefined
    const buttons = (markup?.inline_keyboard ?? []).flat().map((b) => ({ id: b.callback_data ?? '', title: b.text, ...(b.url ? { url: b.url } : {}) }))
    if (markup) msg['reply_markup'] = markup
    switch (method) {
      case 'sendMessage':
        msg['text'] = p['text']
        this.recordOutbound(buttons.length ? { id, chatId: chat, kind: 'buttons', text: String(p['text']), buttons, raw: p } : { id, chatId: chat, kind: 'text', text: String(p['text']), raw: p })
        break
      case 'sendLocation': case 'sendVenue':
        msg['location'] = { latitude: p['latitude'], longitude: p['longitude'] }
        this.recordOutbound({ id, chatId: chat, kind: 'location', location: { latitude: Number(p['latitude']), longitude: Number(p['longitude']), ...(p['title'] ? { name: String(p['title']) } : {}), ...(p['address'] ? { address: String(p['address']) } : {}) }, raw: p })
        break
      case 'sendContact':
        msg['contact'] = { phone_number: p['phone_number'], first_name: p['first_name'] }
        this.recordOutbound({ id, chatId: chat, kind: 'contact', text: String(p['first_name']), raw: p })
        break
      case 'sendPoll': {
        const options = (p['options'] as Array<string | { text: string }>).map((o) => (typeof o === 'string' ? o : o.text))
        const pollId = ids.digits(19)
        msg['poll'] = { id: pollId, question: p['question'], options: options.map((text) => ({ text, voter_count: 0 })), total_voter_count: 0, is_closed: false, is_anonymous: p['is_anonymous'] !== false, type: 'regular', allows_multiple_answers: !!p['allows_multiple_answers'] }
        this.recordOutbound({ id, chatId: chat, kind: 'poll', poll: { question: String(p['question']), options }, targetId: pollId, raw: p })
        break
      }
      default: {
        const field = method.replace(/^send/, '').toLowerCase()
        const kind = MEDIA_FIELD[field] ?? 'unknown'
        const value = p[field]
        let mediaInfo: OutboundRecord['media'] = {}
        if (value && typeof value === 'object' && (value as { __file?: boolean }).__file) {
          const f = value as { name: string; type: string; data: Buffer }
          const item = this.media.put(f.data, { mimetype: f.type || KIND_MIME[kind] || 'application/octet-stream', filename: f.name, origin: 'bot' })
          mediaInfo = { mediaId: this.fileIdFor(item.id, kind), filename: f.name }
        } else if (typeof value === 'string') {
          mediaInfo = /^https?:\/\//.test(value) ? { url: value } : { mediaId: value }
        }
        if (typeof p['caption'] === 'string') msg['caption'] = p['caption']
        this.recordOutbound({ id, chatId: chat, kind, ...(typeof p['caption'] === 'string' ? { text: p['caption'], caption: p['caption'] } : {}), media: mediaInfo, ...(buttons.length ? { buttons } : {}), raw: { ...p, ...(mediaInfo.mediaId ? { [field]: mediaInfo.mediaId } : {}) } })
      }
    }
    this.sentMessages.set(`${chat}:${id}`, msg)
    return ok(msg)
  }

  override resolveMedia(id: string): StoredMedia | undefined {
    const entry = this.fileIds.get(id)
    return this.media.peek(entry ? entry.id : id)
  }

  private fileIdFor(mediaId: string, kind: string): string {
    const fileId = `AgAC${Buffer.from(mediaId).toString('base64url')}`
    this.fileIds.set(fileId, { id: mediaId, path: `${kind === 'image' ? 'photos' : `${kind}s`}/file_${mediaId}` })
    return fileId
  }

  private async getUpdates(p: Record<string, unknown>): Promise<SimResponse> {
    if (this.webhookUrl) return fail(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first")
    const offset = typeof p['offset'] === 'number' ? p['offset'] : 0
    // Confirm (drop) everything below the offset, like Telegram.
    while (this.queue.length && this.queue[0]!.update_id < offset) this.queue.shift()
    const limit = typeof p['limit'] === 'number' ? p['limit'] : 100
    const timeoutSec = typeof p['timeout'] === 'number' ? p['timeout'] : 0
    if (this.queue.length === 0 && timeoutSec > 0) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(t); this.waiters.delete(done); resolve() }
        const t = setTimeout(done, Math.min(timeoutSec, 5) * 1000)
        this.waiters.add(done)
      })
    }
    return ok(this.queue.slice(0, limit))
  }

  protected async beforeStop(): Promise<void> {
    for (const w of [...this.waiters]) w()
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    switch (kind) {
      case 'rateLimit': return fail(429, `Too Many Requests: retry after ${Math.ceil(retryAfterSec)}`, { parameters: { retry_after: Math.ceil(retryAfterSec) } }, { 'retry-after': String(Math.ceil(retryAfterSec)) })
      case 'invalidRecipient': return fail(400, 'Bad Request: chat not found')
      case 'outsideWindow': return fail(403, 'Forbidden: bot was blocked by the user')
      case 'mediaTooLarge': return fail(413, 'Request Entity Too Large')
      case 'auth': return fail(401, 'Unauthorized')
      case 'serverError': return fail(500, 'Internal Server Error')
    }
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return fail(400, `Bad Request: ${issues.slice(0, 3).join('; ')}`)
  }

  protected notFound(): SimResponse {
    return fail(404, 'Not Found')
  }

  /* --- inbound ---------------------------------------------------------- */

  private from(user: { id: string; name?: string }): Record<string, unknown> {
    return { id: Number(user.id), is_bot: false, first_name: user.name ?? 'User', username: (user.name ?? 'user').toLowerCase().replace(/\W+/g, '_'), language_code: 'es' }
  }

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const date = Math.floor(at / 1000)
    const chat = { id: Number(user.id), first_name: user.name ?? 'User', type: 'private' }
    const update: Record<string, unknown> = { update_id: ++this.updateId }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    let id: string
    if (input.reply) {
      const r = input.reply
      const target = r.messageId ? this.sentMessages.get(`${user.id}:${r.messageId}`) : [...this.sentMessages.entries()].reverse().find(([k, m]) => k.startsWith(`${user.id}:`) && m['reply_markup'])?.[1]
      id = ids.digits(19)
      update['callback_query'] = { id, from: this.from(user), message: target ?? this.messageBase(user.id, this.messageId), chat_instance: ids.digits(19), data: r.id }
      kind = r.kind
      text = r.title ?? r.id
      const record = { id, channel: this.channel, chatId: user.id, user, kind, text, at }
      return { id, chatId: user.id, record, payload: update }
    }
    if (input.pollVote) {
      id = ids.digits(10)
      update['poll_answer'] = { poll_id: input.pollVote.pollId, user: this.from(user), option_ids: input.pollVote.optionIds }
      return { id, chatId: user.id, record: { id, channel: this.channel, chatId: user.id, user, kind: 'poll_vote', text: input.pollVote.optionIds.join(','), at }, payload: update }
    }
    const messageId = input.edit ? Number(input.edit.messageId) : input.id ? Number(input.id) : this.messageId++
    id = String(messageId)
    const msg: Record<string, unknown> = { message_id: messageId, from: this.from(user), chat, date }
    if (input.quotedId) msg['reply_to_message'] = this.sentMessages.get(`${user.id}:${input.quotedId}`) ?? { message_id: Number(input.quotedId), chat, date }
    if (input.edit) {
      msg['text'] = input.edit.text
      msg['edit_date'] = date
      update['edited_message'] = msg
      return { id, chatId: user.id, record: { id, channel: this.channel, chatId: user.id, user, kind: 'edit', text: input.edit.text, at }, payload: update }
    }
    if (input.text !== undefined) {
      msg['text'] = input.text
      if (input.text.startsWith('/')) msg['entities'] = [{ offset: 0, length: input.text.split(/\s/)[0]!.length, type: 'bot_command' }]
      text = input.text
    } else if (input.media) {
      const m = input.media
      const mimetype = m.mimetype ?? KIND_MIME[m.kind] ?? 'application/octet-stream'
      const item = this.media.put(m.data, { mimetype, ...(m.filename ? { filename: m.filename } : {}) })
      const fileId = this.fileIdFor(item.id, m.kind)
      const base = { file_id: fileId, file_unique_id: item.id.slice(0, 15), file_size: m.data.length }
      if (m.kind === 'image') msg['photo'] = [{ ...base, width: 90, height: 90 }, { ...base, width: 800, height: 800 }]
      else if (m.kind === 'document') msg['document'] = { ...base, file_name: m.filename ?? 'file', mime_type: mimetype }
      else if (m.kind === 'voice') msg['voice'] = { ...base, duration: 3, mime_type: mimetype }
      else if (m.kind === 'audio') msg['audio'] = { ...base, duration: 3, mime_type: mimetype }
      else if (m.kind === 'video') msg['video'] = { ...base, duration: 3, width: 640, height: 360, mime_type: mimetype }
      else msg['sticker'] = { ...base, width: 512, height: 512, is_animated: false, is_video: false, type: 'regular' }
      if (m.caption) msg['caption'] = m.caption
      kind = m.kind
      text = m.caption
    } else if (input.location) {
      const l = input.location
      if (l.name && l.address) msg['venue'] = { location: { latitude: l.latitude, longitude: l.longitude }, title: l.name, address: l.address }
      msg['location'] = { latitude: l.latitude, longitude: l.longitude }
      kind = 'location'
    } else {
      throw new Error('Telegram simulator: send text, media, location, a callback, a poll vote or an edit')
    }
    update['message'] = msg
    return { id, chatId: user.id, record: { id, channel: this.channel, chatId: user.id, user, kind, ...(text !== undefined ? { text } : {}), at }, payload: update }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    const update = prepared.payload as { update_id: number }
    if (this.webhookUrl) return { id: prepared.id, chatId: prepared.chatId, deliveries: await this.post(update) }
    // A redelivered (cloned) update gets a fresh update_id, like a real duplicate would.
    if (this.queue.some((u) => u.update_id === update.update_id) || update.update_id <= (this.queue.at(-1)?.update_id ?? 0)) {
      this.queue.push({ ...update, update_id: ++this.updateId })
    } else {
      this.queue.push(update)
    }
    for (const w of [...this.waiters]) w()
    const rec = { url: 'getUpdates', status: 200, ok: true, attempt: 1, at: Date.now() }
    this.deliveries.push(rec)
    return { id: prepared.id, chatId: prepared.chatId, deliveries: [rec] }
  }

  /** Telegram has no delivery receipts for bots. */
  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    this.recordInbound({ id: messageId, channel: this.channel, chatId: '', user: { id: String(this.botId) }, kind: 'status', text: status, at: Date.now() })
    return { id: messageId, chatId: '', deliveries: [] }
  }

  /** POST an Update to the webhook (`secret: false` omits the secret header). */
  async post(update: unknown, opts: { secret?: string | false } = {}): Promise<SendOutcome['deliveries']> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const secret = opts.secret === false ? undefined : opts.secret ?? this.apiSecret ?? this.webhookSecret
    if (secret !== undefined) headers['x-telegram-bot-api-secret-token'] = secret
    return this.postWebhook(JSON.stringify(update), headers)
  }
}

function safeJson(v: string): unknown {
  try { return JSON.parse(v) } catch { return v }
}
