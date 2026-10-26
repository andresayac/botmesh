/**
 * HighLevel (LeadConnector) Conversations API simulator. Implements
 * `POST /conversations/messages` and `PUT /conversations/{id}` (Bearer token +
 * `Version` header), hosts attachment URLs and delivers `InboundMessage`
 * webhooks signed with `X-GHL-Signature` (Ed25519 over the raw body). The
 * simulator generates its own key pair; `providerConfig()` hands the provider
 * the public key, so the signatures are real.
 *
 * Request shapes follow the HighLevel API v2 reference ("Send a new message":
 * `type` + `contactId`, plus `message`, `attachments`, `html`/`subject` for
 * email or `templateId`).
 */

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import {
  PlatformSimulator,
  bearer,
  ids,
  type BaseSimulatorOptions,
  type FaultKind,
  type MessageStatus,
  type PreparedInbound,
  type SendOutcome,
  type UserInput,
} from '../sim/base.js'
import type { SimRequest, SimResponse } from '../sim/http.js'
import { KIND_MIME } from '../sim/media.js'
import type { Schema } from '../sim/validate.js'

export interface GoHighLevelSimulatorOptions extends BaseSimulatorOptions {
  accessToken?: string
  locationId?: string
  /** Channel the simulated contact writes on. Default `'SMS'`. */
  messageType?: 'SMS' | 'WhatsApp' | 'Email' | 'IG' | 'FB' | 'Live_Chat' | 'GMB' | 'Custom'
}

/** `POST /conversations/messages` body. */
export const GHL_SEND_SCHEMA: Schema = {
  type: 'object',
  required: ['type', 'contactId'],
  properties: {
    type: { enum: ['SMS', 'WhatsApp', 'Email', 'IG', 'FB', 'Custom', 'Live_Chat', 'GMB'] },
    contactId: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    attachments: { type: 'array', items: { type: 'string', pattern: '^https?://' } },
    html: { type: 'string' },
    subject: { type: 'string' },
    emailFrom: { type: 'string' },
    emailTo: { type: 'string' },
    templateId: { type: 'string' },
    replyMessageId: { type: 'string' },
    threadId: { type: 'string' },
    fromNumber: { type: 'string' },
    toNumber: { type: 'string' },
    conversationProviderId: { type: 'string' },
    scheduledTimestamp: { type: 'number' },
  },
}

function ghlId(): string {
  return ids.hex(10).slice(0, 20)
}

export class GoHighLevelSimulator extends PlatformSimulator {
  readonly channel = 'gohighlevel' as const
  readonly title = 'HighLevel (LeadConnector)'
  readonly accessToken: string
  readonly locationId: string
  readonly publicKeyPem: string
  private readonly privateKey: KeyObject
  private readonly messageType: string
  /** contactId → conversationId */
  private readonly conversations = new Map<string, string>()

  constructor(options: GoHighLevelSimulatorOptions = {}) {
    super(options, { id: 'cnt_SandboxContact01', name: 'Sandbox User' })
    this.accessToken = options.accessToken ?? 'pit-sandbox-ghl-token'
    this.locationId = options.locationId ?? 've9EPM428h8vShlRW1KT'
    this.messageType = options.messageType ?? 'SMS'
    const pair = generateKeyPairSync('ed25519')
    this.privateKey = pair.privateKey
    this.publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }

  providerConfig(): { accessToken: string; locationId: string; baseUrl: string; publicKey: string; http: { allowHttp: true; allowPrivateHosts: true } } {
    return { accessToken: this.accessToken, locationId: this.locationId, baseUrl: this.url, publicKey: this.publicKeyPem, http: { allowHttp: true, allowPrivateHosts: true } }
  }

  private readonly auth = (req: SimRequest): boolean => bearer(req) === this.accessToken

  private conversationOf(contactId: string): string {
    let id = this.conversations.get(contactId)
    if (!id) {
      id = ghlId()
      this.conversations.set(contactId, id)
    }
    return id
  }

  protected routes(): void {
    this.api('GET', '/ghl/media/:id/:name', (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 404, body: { statusCode: 404, message: 'Not Found' } }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    this.api('POST', '/conversations/messages', (req) => {
      const body = req.json() as Record<string, unknown>
      const contactId = String(body['contactId'])
      const conversationId = this.conversationOf(contactId)
      const messageId = ghlId()
      const attachments = (body['attachments'] as string[] | undefined) ?? []
      const text = typeof body['message'] === 'string' ? body['message'] : undefined
      if (typeof body['templateId'] === 'string') this.recordOutbound({ id: messageId, chatId: contactId, kind: 'template', template: { name: body['templateId'] }, raw: body })
      else if (attachments.length) this.recordOutbound({ id: messageId, chatId: contactId, kind: kindOf(attachments[0]!), ...(text ? { text, caption: text } : {}), media: { url: attachments[0]! }, raw: body })
      else this.recordOutbound({ id: messageId, chatId: contactId, kind: 'text', text: text ?? '', raw: body })
      return { status: 201, body: { conversationId, messageId, msg: 'Message queued successfully.' } }
    }, {
      send: true,
      auth: this.auth,
      schema: (req) => ({ schema: GHL_SEND_SCHEMA, value: req.json() }),
      check: (req) => {
        const issues: string[] = []
        if (req.header('version') !== '2021-04-15') issues.push(`Version header: expected 2021-04-15 (got ${req.header('version')})`)
        const b = req.json() as Record<string, unknown> | undefined
        if (b && b['message'] === undefined && b['attachments'] === undefined && b['templateId'] === undefined && b['html'] === undefined) issues.push('$: message, attachments, html or templateId is required')
        if (b?.['type'] === 'Email' && b['html'] === undefined && b['message'] === undefined) issues.push('$.html: required for Email')
        return issues
      },
    })
    this.api('PUT', '/conversations/:id', (req) => {
      const body = req.json() as Record<string, unknown>
      this.recordOutbound({ id: '', chatId: '', kind: 'action', action: 'mark_read', targetId: req.params['id']!, raw: body })
      return { status: 200, body: { success: true, conversation: { id: req.params['id'], locationId: this.locationId, unreadCount: 0 } } }
    }, {
      auth: this.auth,
      check: (req) => {
        const b = req.json() as Record<string, unknown> | undefined
        return b?.['locationId'] === this.locationId ? [] : ['$.locationId: required and must be the token location']
      },
    })
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    const err = (statusCode: number, message: string, error: string, headers: Record<string, string> = {}): SimResponse => ({ status: statusCode, headers, body: { statusCode, message, error } })
    switch (kind) {
      case 'rateLimit': return err(429, 'Too Many Requests', 'Too Many Requests', { 'retry-after': String(retryAfterSec), 'x-ratelimit-remaining': '0', 'x-ratelimit-interval-milliseconds': '10000' })
      case 'invalidRecipient': return err(400, 'Contact not found', 'Bad Request')
      case 'outsideWindow': return err(400, 'Message failed to send because more than 24 hours have passed since the customer last replied to this number', 'Bad Request')
      case 'mediaTooLarge': return err(413, 'Attachment size exceeds the limit', 'Payload Too Large')
      case 'auth': return err(401, 'Invalid JWT', 'Unauthorized')
      case 'serverError': return err(500, 'Internal server error', 'Internal Server Error')
    }
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return { status: 422, body: { statusCode: 422, message: issues.slice(0, 5), error: 'Unprocessable Entity' } }
  }

  /* --- inbound ---------------------------------------------------------- */

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const messageId = input.id ?? ghlId()
    const body: Record<string, unknown> = {
      type: 'InboundMessage',
      locationId: this.locationId,
      attachments: [] as string[],
      body: '',
      contactId: user.id,
      contentType: 'text/plain',
      conversationId: this.conversationOf(user.id),
      dateAdded: new Date(at).toISOString(),
      direction: 'inbound',
      messageType: this.messageType,
      messageId,
      webhookId: ids.hex(12),
      timestamp: new Date(at).toISOString(),
    }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.text !== undefined) {
      body['body'] = input.text
      text = input.text
    } else if (input.reply) {
      // No native buttons: the contact answers the numbered menu with text.
      body['body'] = input.reply.title ?? input.reply.id
      kind = input.reply.kind
      text = String(body['body'])
    } else if (input.media) {
      const m = input.media
      const mimetype = m.mimetype ?? KIND_MIME[m.kind] ?? 'application/octet-stream'
      const item = this.media.put(m.data, { mimetype, ...(m.filename ? { filename: m.filename } : {}) })
      const name = m.filename ?? `file.${extOf(mimetype)}`
      body['attachments'] = [`${this.url}/ghl/media/${item.id}/${encodeURIComponent(name)}`]
      body['body'] = m.caption ?? ''
      body['contentType'] = mimetype
      kind = m.kind
      text = m.caption
    } else {
      throw new Error('HighLevel simulator: send text, media or a menu answer (no location or native interactive messages)')
    }
    return { id: messageId, chatId: user.id, record: { id: messageId, channel: this.channel, chatId: user.id, user, kind, ...(text !== undefined ? { text } : {}), at }, payload: body }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    return { id: prepared.id, chatId: prepared.chatId, deliveries: await this.post(prepared.payload) }
  }

  /** HighLevel reports outbound status in `OutboundMessage` / `LCEmailStats` events (ignored by the provider). */
  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    const contactId = out?.chatId ?? this.defaultUser.id
    const payload = { type: 'OutboundMessage', locationId: this.locationId, contactId, conversationId: this.conversationOf(contactId), messageId, direction: 'outbound', status, messageType: this.messageType, dateAdded: new Date().toISOString() }
    this.recordInbound({ id: messageId, channel: this.channel, chatId: contactId, user: { id: contactId }, kind: 'status', text: status, at: Date.now() })
    return { id: messageId, chatId: contactId, deliveries: await this.post(payload) }
  }

  /** POST a webhook body signed with the simulator's Ed25519 key (`signature: false` omits it). */
  async post(payload: unknown, opts: { signature?: string | false } = {}): Promise<SendOutcome['deliveries']> {
    const raw = Buffer.from(JSON.stringify(payload), 'utf8')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.signature !== false) headers['x-ghl-signature'] = opts.signature ?? sign(null, raw, this.privateKey).toString('base64')
    return this.postWebhook(raw, headers)
  }
}

function extOf(mime: string): string {
  const map: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'application/pdf': 'pdf' }
  return map[mime] ?? 'bin'
}

function kindOf(url: string): 'image' | 'video' | 'audio' | 'document' {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (['mp4', 'mov', '3gp'].includes(ext)) return 'video'
  if (['mp3', 'ogg', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio'
  return 'document'
}
