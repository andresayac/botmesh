/**
 * TikTok API for Business simulator (Business Messaging DMs and comment
 * replies). Implements the v1.3 endpoints `@botmesh/tiktok` calls —
 * `business/message/send/`, `business/message/media/upload/`,
 * `business/message/media/download/` and `business/comment/reply/create/`
 * (`Access-Token` header, `{ code, message, request_id, data }` envelope, errors
 * as HTTP 200 with a non-zero `code`) — and delivers webhooks signed with
 * `TikTok-Signature: t=<unix>,s=<hex HMAC-SHA256(secret, "t.body")>`.
 */

import { createHmac } from 'node:crypto'
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
import { KIND_MIME } from '../sim/media.js'
import type { Schema } from '../sim/validate.js'

export interface TikTokSimulatorOptions extends BaseSimulatorOptions {
  accessToken?: string
  appSecret?: string
  /** The business account `open_id` (`business_id`). */
  businessId?: string
  /** The business account's `unique_identifier` (handle). */
  businessHandle?: string
  clientKey?: string
}

/** `business/message/send/` body. */
export const TIKTOK_SEND_SCHEMA: Schema = {
  type: 'object',
  required: ['business_id', 'recipient_type', 'recipient', 'message_type'],
  properties: {
    business_id: { type: 'string', minLength: 1 },
    recipient_type: { enum: ['CONVERSATION', 'COMMENT'] },
    recipient: { type: 'string', minLength: 1 },
    message_type: { enum: ['TEXT', 'IMAGE', 'TEMPLATE', 'SENDER_ACTION', 'SHARE_POST', 'EMOJI'] },
    text: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 6000 } } },
    image: { type: 'object', required: ['media_id'], properties: { media_id: { type: 'string', minLength: 1 } } },
    sender_action: { enum: ['TYPING', 'MARK_READ'] },
    referenced_message_info: { type: 'object', required: ['referenced_message_id'] },
    template: {
      type: 'object', required: ['type', 'title', 'buttons'],
      properties: {
        type: { enum: ['QA_BUTTON_CARD', 'QA_LINK_CARD'] },
        title: { type: 'string', minLength: 1, maxLength: 40 },
        buttons: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', required: ['type', 'title'], properties: { type: { enum: ['REPLY', 'URL'] }, title: { type: 'string', minLength: 1, maxLength: 40 }, id: { type: 'string' }, url: { type: 'string' } } } },
      },
    },
  },
}

function sendRules(b: Record<string, unknown>): string[] {
  const issues: string[] = []
  const type = b['message_type']
  const need = (k: string) => { if (b[k] === undefined) issues.push(`$.${k}: required for message_type ${String(type)}`) }
  if (type === 'TEXT') need('text')
  if (type === 'IMAGE') need('image')
  if (type === 'TEMPLATE') need('template')
  if (type === 'SENDER_ACTION') need('sender_action')
  const t = b['template'] as { type?: string; buttons?: Array<{ title?: string }> } | undefined
  if (t?.type === 'QA_BUTTON_CARD' && t.buttons?.some((x) => [...(x.title ?? '')].length > 20)) issues.push('$.template.buttons[].title: at most 20 characters on a QA_BUTTON_CARD')
  return issues
}

function envelope(data: unknown, code = 0, message = 'OK'): SimResponse {
  return { status: 200, headers: { 'x-tt-logid': ids.upperHex(14) }, body: { code, message, request_id: ids.digits(18), data } }
}

export class TikTokSimulator extends PlatformSimulator {
  readonly channel = 'tiktok' as const
  readonly title = 'TikTok Business Messaging'
  readonly accessToken: string
  readonly appSecret: string
  readonly businessId: string
  readonly businessHandle: string
  readonly clientKey: string
  private readonly conversations = new Map<string, string>()

  constructor(options: TikTokSimulatorOptions = {}) {
    super(options, { id: '-000aBcDeFgHiJkLmNoPqRsTuVwXyZ', name: 'sandbox.user' })
    this.accessToken = options.accessToken ?? 'act.sandbox-tiktok-token'
    this.appSecret = options.appSecret ?? 'sandbox-tiktok-app-secret'
    this.businessId = options.businessId ?? '-000BusinessOpenId0000000000'
    this.businessHandle = options.businessHandle ?? 'sandbox.bakery'
    this.clientKey = options.clientKey ?? 'awsandboxclientkey'
  }

  providerConfig(): { accessToken: string; businessId: string; appSecret: string; apiBaseUrl: string; selfUniqueIdentifier: string; http: { allowHttp: true; allowPrivateHosts: true } } {
    return { accessToken: this.accessToken, businessId: this.businessId, appSecret: this.appSecret, apiBaseUrl: `${this.url}/open_api`, selfUniqueIdentifier: this.businessHandle, http: { allowHttp: true, allowPrivateHosts: true } }
  }

  /** The conversation id of a user (created on first use). */
  conversationOf(userId: string): string {
    let id = this.conversations.get(userId)
    if (!id) {
      id = `${ids.digits(19)}:${ids.digits(19)}`
      this.conversations.set(userId, id)
    }
    return id
  }

  private readonly auth = (req: SimRequest): boolean => req.header('access-token') === this.accessToken

  protected routes(): void {
    this.api('GET', '/tiktok/media/:id', (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 403, body: 'Access Denied: url expired' }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    this.api('POST', '/open_api/:ver/business/message/send/', (req) => {
      const b = req.json() as Record<string, unknown>
      const conversationId = String(b['recipient'])
      const chatId = `dm:${conversationId}`
      if (b['message_type'] === 'SENDER_ACTION') {
        this.recordOutbound({ id: '', chatId, kind: 'action', action: String(b['sender_action']), raw: b })
        return envelope({})
      }
      const messageId = ids.digits(19)
      this.recordOutbound({ id: messageId, chatId, ...describe(b), raw: b })
      return envelope({ message: { message_id: messageId, conversation_id: conversationId } })
    }, { send: true, auth: this.auth, schema: (req) => ({ schema: TIKTOK_SEND_SCHEMA, value: req.json() }), check: (req) => this.checkBusiness(req, true) })
    this.api('POST', '/open_api/:ver/business/message/media/upload/', async (req) => {
      const form = await req.multipart()
      const file = form.get('file')
      if (!(file instanceof Blob)) return envelope({}, 40002, 'Invalid parameter: file')
      const data = Buffer.from(await file.arrayBuffer())
      if (data.length > 10 * 1024 * 1024) return this.faultResponse('mediaTooLarge', req, 0)
      const item = this.media.put(data, { mimetype: file.type || 'image/jpeg', origin: 'bot', id: `v0${ids.hex(12)}` })
      return envelope({ media_id: item.id })
    }, {
      send: true,
      auth: this.auth,
      check: async (req) => {
        const form = await req.multipart().catch(() => undefined)
        if (!form) return ['body: not multipart/form-data']
        const issues: string[] = []
        if (form.get('business_id') !== this.businessId) issues.push('business_id: required and must be the authorized account')
        if (form.get('media_type') !== 'IMAGE') issues.push('media_type: must be IMAGE')
        if (!(form.get('file') instanceof Blob)) issues.push('file: required')
        return issues
      },
    })
    this.api('POST', '/open_api/:ver/business/message/media/download/', (req) => {
      const b = req.json() as Record<string, unknown>
      const item = this.media.peek(String(b['media_id']))
      if (!item) return envelope({}, 40007, 'The media does not exist')
      return envelope({ download_url: `${this.url}/tiktok/media/${item.id}?x-expires=${Math.floor((item.expiresAt ?? Date.now() + 3_600_000) / 1000)}` })
    }, {
      auth: this.auth,
      check: (req) => {
        const b = req.json() as Record<string, unknown> | undefined
        const issues = this.checkBusiness(req, false)
        for (const k of ['conversation_id', 'message_id', 'media_id', 'media_type']) if (!b?.[k]) issues.push(`$.${k}: required`)
        return issues
      },
    })
    this.api('POST', '/open_api/:ver/business/comment/reply/create/', (req) => {
      const b = req.json() as Record<string, unknown>
      const commentId = ids.digits(19)
      this.recordOutbound({ id: commentId, chatId: `comment:${String(b['video_id'])}:${String(b['comment_id'])}`, kind: 'text', text: String(b['text'] ?? ''), raw: b })
      return envelope({ comment_id: commentId, video_id: b['video_id'], text: b['text'], create_time: Math.floor(Date.now() / 1000) })
    }, {
      send: true,
      auth: this.auth,
      check: (req) => {
        const b = req.json() as Record<string, unknown> | undefined
        const issues = this.checkBusiness(req, false)
        for (const k of ['video_id', 'comment_id', 'text']) if (!b?.[k]) issues.push(`$.${k}: required`)
        if (typeof b?.['text'] === 'string' && [...b['text']].length > 150) issues.push('$.text: at most 150 characters')
        return issues
      },
    })
  }

  private checkBusiness(req: SimRequest, send: boolean): string[] {
    const b = req.json() as Record<string, unknown> | undefined
    const issues: string[] = []
    if (b?.['business_id'] !== this.businessId) issues.push('$.business_id: must be the authorized account open_id')
    if (send && b) issues.push(...sendRules(b))
    if (!(req.header('content-type') ?? '').includes('application/json')) issues.push('Content-Type: must be application/json')
    return issues
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    switch (kind) {
      case 'rateLimit': {
        const out = envelope({}, 40100, 'Too many requests. Please retry in some time.')
        return { ...out, headers: { ...out.headers, 'retry-after': String(retryAfterSec) } }
      }
      case 'invalidRecipient': return envelope({}, 40007, 'The conversation does not exist.')
      case 'outsideWindow': return envelope({}, 40002, 'Message cannot be sent: the 48-hour messaging window has expired.')
      case 'mediaTooLarge': return envelope({}, 40002, 'File size exceeds the limit (10 MB).')
      case 'auth': return envelope({}, 40105, 'Access token is incorrect or has been revoked.')
      case 'serverError': return { status: 500, body: { code: 50000, message: 'Internal error', request_id: ids.digits(18) } }
    }
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return envelope({}, 40002, `Invalid parameter: ${issues.slice(0, 3).join('; ')}`)
  }

  protected notFound(): SimResponse {
    return { status: 404, body: { code: 40400, message: 'Not found', request_id: ids.digits(18) } }
  }

  /* --- inbound ---------------------------------------------------------- */

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const conversationId = this.conversationOf(user.id)
    const messageId = input.id ?? ids.digits(19)
    const dm: Record<string, unknown> = {
      from: user.name ?? user.id,
      to: this.businessHandle,
      from_user: { id: user.id, role: 'personal_account' },
      to_user: { id: this.businessId, role: 'business_account' },
      conversation_id: conversationId,
      message_id: messageId,
      timestamp: at,
      unique_identifier: user.name ?? user.id,
      is_follower: true,
    }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.quotedId) dm['referenced_message_info'] = { referenced_message_id: input.quotedId }
    if (input.text !== undefined) {
      dm['type'] = 'text'
      dm['text'] = { body: input.text }
      text = input.text
    } else if (input.reply) {
      const r = input.reply
      dm['type'] = 'text'
      dm['text'] = { body: r.title ?? r.id }
      dm['reply_source_payload'] = { reply_source_msg_id: r.messageId ?? this.outbox.filter((o) => o.kind === 'buttons' || o.kind === 'list').at(-1)?.id ?? '', reply_source_unique_id: r.id }
      kind = r.kind
      text = r.title ?? r.id
    } else if (input.media && (input.media.kind === 'image' || input.media.kind === 'video')) {
      const m = input.media
      const item = this.media.put(m.data, { mimetype: m.mimetype ?? KIND_MIME[m.kind] ?? 'image/jpeg', id: `v0${ids.hex(12)}` })
      dm['type'] = m.kind
      dm[m.kind] = { media_id: item.id }
      kind = m.kind
    } else if (input.media?.kind === 'sticker') {
      const item = this.media.put(input.media.data, { mimetype: input.media.mimetype ?? 'image/webp' })
      dm['type'] = 'sticker'
      dm['sticker'] = { url: `${this.url}/tiktok/media/${item.id}` }
      kind = 'sticker'
    } else {
      throw new Error('TikTok simulator: DMs carry text, image, video, sticker or a card button reply')
    }
    const payload = this.wrap('im_receive_msg', dm, at)
    return { id: messageId, chatId: `dm:${conversationId}`, record: { id: messageId, channel: this.channel, chatId: `dm:${conversationId}`, user, kind, ...(text !== undefined ? { text } : {}), at }, payload }
  }

  /** A public comment on one of the business's videos (`comment.update`). */
  async comment(text: string, opts: { videoId?: string; parentCommentId?: string; user?: Partial<{ id: string; name: string }> } = {}): Promise<SendOutcome> {
    const user = this.user({ ...(opts.user ? { user: opts.user } : {}) })
    const at = Date.now()
    const commentId = ids.digits(19)
    const videoId = opts.videoId ?? '7300000000000000001'
    const content = {
      comment_id: Number(commentId), video_id: Number(videoId),
      ...(opts.parentCommentId ? { parent_comment_id: Number(opts.parentCommentId) } : {}),
      comment_type: opts.parentCommentId ? 'reply' : 'comment', comment_action: 'insert',
      timestamp: Math.floor(at / 1000), unique_identifier: user.name ?? user.id, text,
    }
    const chatId = `comment:${videoId}:${opts.parentCommentId ?? commentId}`
    this.recordInbound({ id: commentId, channel: this.channel, chatId, user, kind: 'text', text, at })
    // Ids as JSON numbers beyond 2^53, like TikTok: written by hand so they are not rounded.
    const raw = JSON.stringify(content).replace(/"comment_id":\d+/, `"comment_id":${commentId}`).replace(/"video_id":\d+/, `"video_id":${videoId}`)
    const payload = { client_key: this.clientKey, event: 'comment.update', create_time: Math.floor(at / 1000), user_openid: this.businessId, content: raw }
    return { id: commentId, chatId, deliveries: await this.post(payload) }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    return { id: prepared.id, chatId: prepared.chatId, deliveries: await this.post(prepared.payload) }
  }

  /** TikTok confirms business sends with an `im_send_msg` echo (the provider reports it as `sent`). */
  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    const chatId = out?.chatId ?? `dm:${this.conversationOf(this.defaultUser.id)}`
    const conversationId = chatId.replace(/^dm:/, '')
    const dm = {
      from: this.businessHandle, to: this.defaultUser.name, from_user: { id: this.businessId, role: 'business_account' },
      to_user: { id: this.defaultUser.id, role: 'personal_account' }, conversation_id: conversationId, message_id: messageId,
      timestamp: Date.now(), type: 'text', text: { body: out?.text ?? '' },
    }
    this.recordInbound({ id: messageId, channel: this.channel, chatId, user: { id: this.businessId }, kind: 'status', text: status, at: Date.now() })
    return { id: messageId, chatId, deliveries: await this.post(this.wrap('im_send_msg', dm, Date.now())) }
  }

  private wrap(event: string, content: unknown, at: number): unknown {
    return { client_key: this.clientKey, event, create_time: Math.floor(at / 1000), user_openid: this.businessId, content: JSON.stringify(content) }
  }

  /** POST a webhook signed with `TikTok-Signature` (`signature: false` omits it; `timestamp` overrides `t`). */
  async post(payload: unknown, opts: { signature?: string | false; timestamp?: number } = {}): Promise<SendOutcome['deliveries']> {
    const raw = JSON.stringify(payload)
    const t = opts.timestamp ?? Math.floor(Date.now() / 1000)
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-tt-logid': ids.upperHex(14) }
    if (opts.signature !== false) headers['tiktok-signature'] = opts.signature ?? `t=${t},s=${createHmac('sha256', this.appSecret).update(`${t}.${raw}`).digest('hex')}`
    return this.postWebhook(raw, headers)
  }
}

function describe(b: Record<string, unknown>): Omit<OutboundRecord, 'id' | 'chatId' | 'channel' | 'raw' | 'at'> {
  switch (b['message_type']) {
    case 'TEXT': return { kind: 'text', text: String((b['text'] as { body?: string } | undefined)?.body ?? '') }
    case 'IMAGE': return { kind: 'image', media: { mediaId: String((b['image'] as { media_id?: string } | undefined)?.media_id ?? '') } }
    case 'TEMPLATE': {
      const t = (b['template'] ?? {}) as { title?: string; buttons?: Array<{ id?: string; title: string; url?: string }> }
      return { kind: 'buttons', text: t.title ?? '', buttons: (t.buttons ?? []).map((x) => ({ id: x.id ?? x.title, title: x.title, ...(x.url ? { url: x.url } : {}) })) }
    }
    default: return { kind: 'unknown' }
  }
}
