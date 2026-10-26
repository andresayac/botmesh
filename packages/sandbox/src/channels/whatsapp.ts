/**
 * WhatsApp Cloud API simulator (Meta Graph). Implements what `@botmesh/meta`
 * calls — `POST /{version}/{phone-number-id}/messages`, `POST .../media`,
 * `GET /{version}/{media-id}` and the media download — and delivers
 * `whatsapp_business_account` webhooks signed with `X-Hub-Signature-256`.
 *
 * Request shapes follow Meta's "Messages" reference and the WhatsApp Business
 * Platform OpenAPI document (github.com/facebook/openapi); limits are the
 * documented ones (text 4096, caption 1024, 3 reply buttons of 20 chars, 10
 * list rows of 24 chars, …).
 */

import { randomBytes } from 'node:crypto'
import {
  PlatformSimulator,
  bearer,
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
import { graphError, graphFault, graphInvalid, hubSignature, verifySubscription } from './graph.js'

export interface WhatsAppSimulatorOptions extends BaseSimulatorOptions {
  accessToken?: string
  appSecret?: string
  verifyToken?: string
  phoneNumberId?: string
  displayPhoneNumber?: string
  wabaId?: string
}

const mediaObject: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    link: { type: 'string', pattern: '^https?://' },
    caption: { type: 'string', maxLength: 1024 },
    filename: { type: 'string', maxLength: 240 },
  },
}

const interactive: Schema = {
  type: 'object',
  required: ['type', 'action'],
  properties: {
    type: { enum: ['button', 'list', 'cta_url', 'flow', 'product', 'product_list', 'location_request_message', 'address_message', 'call_permission_request'] },
    header: { type: 'object', required: ['type'], properties: { type: { enum: ['text', 'image', 'video', 'document'] }, text: { type: 'string', maxLength: 60 } } },
    body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 1024 } } },
    footer: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 60 } } },
    action: {
      type: 'object',
      properties: {
        button: { type: 'string', minLength: 1, maxLength: 20 },
        buttons: {
          type: 'array', minItems: 1, maxItems: 3,
          items: {
            type: 'object', required: ['type', 'reply'],
            properties: {
              type: { const: 'reply' },
              reply: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, title: { type: 'string', minLength: 1, maxLength: 20 } } },
            },
          },
        },
        sections: {
          type: 'array', minItems: 1, maxItems: 10,
          items: {
            type: 'object', required: ['rows'],
            properties: {
              title: { type: 'string', maxLength: 24 },
              rows: {
                type: 'array', minItems: 1, maxItems: 10,
                items: {
                  type: 'object', required: ['id', 'title'],
                  properties: { id: { type: 'string', minLength: 1, maxLength: 200 }, title: { type: 'string', minLength: 1, maxLength: 24 }, description: { type: 'string', maxLength: 72 } },
                },
              },
            },
          },
        },
        name: { type: 'string' },
        parameters: { type: 'object' },
      },
    },
  },
}

/** `POST /{phone-number-id}/messages` body (send, mark-as-read). */
export const WHATSAPP_MESSAGE_SCHEMA: Schema = {
  type: 'object',
  required: ['messaging_product'],
  properties: {
    messaging_product: { const: 'whatsapp' },
    recipient_type: { enum: ['individual', 'group'] },
    to: { type: 'string', minLength: 1 },
    recipient: { type: 'string', minLength: 1 },
    type: { enum: ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'interactive', 'template', 'reaction'] },
    context: { type: 'object', required: ['message_id'], properties: { message_id: { type: 'string', minLength: 1 } } },
    status: { const: 'read' },
    message_id: { type: 'string', minLength: 1 },
    typing_indicator: { type: 'object', required: ['type'], properties: { type: { const: 'text' } } },
    text: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 4096 }, preview_url: { type: 'boolean' } } },
    image: mediaObject,
    video: mediaObject,
    audio: mediaObject,
    document: mediaObject,
    sticker: mediaObject,
    location: {
      type: 'object', required: ['latitude', 'longitude'],
      properties: { latitude: { type: ['number', 'string'] }, longitude: { type: ['number', 'string'] }, name: { type: 'string' }, address: { type: 'string' } },
    },
    contacts: { type: 'array', minItems: 1, items: { type: 'object', required: ['name'] } },
    interactive,
    template: {
      type: 'object', required: ['name', 'language'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 512 },
        language: { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 2 } } },
        components: { type: 'array' },
      },
    },
    reaction: { type: 'object', required: ['message_id', 'emoji'], properties: { message_id: { type: 'string' }, emoji: { type: 'string' } } },
  },
}

/** Cross-field rules the schema subset cannot express. */
function messageRules(body: Record<string, unknown>): string[] {
  const issues: string[] = []
  if (body['status'] === 'read') {
    if (typeof body['message_id'] !== 'string') issues.push('$.message_id: required to mark as read')
    return issues
  }
  const type = typeof body['type'] === 'string' ? body['type'] : 'text'
  if (body['to'] === undefined && body['recipient'] === undefined) issues.push('$.to: required (or recipient for a BSUID)')
  if (body['to'] !== undefined && body['recipient'] !== undefined) issues.push('$: send either to or recipient, not both')
  if (body[type] === undefined) issues.push(`$.${type}: required for type '${type}'`)
  for (const kind of ['image', 'video', 'audio', 'document', 'sticker']) {
    const m = body[kind] as Record<string, unknown> | undefined
    if (m && (m['id'] === undefined) === (m['link'] === undefined)) issues.push(`$.${kind}: exactly one of id or link`)
    if (m && (kind === 'audio' || kind === 'sticker') && m['caption'] !== undefined) issues.push(`$.${kind}.caption: not allowed for ${kind}`)
  }
  const inter = body['interactive'] as { type?: string; action?: Record<string, unknown> } | undefined
  if (inter?.type === 'button' && !Array.isArray(inter.action?.['buttons'])) issues.push('$.interactive.action.buttons: required for button')
  if (inter?.type === 'list') {
    const sections = inter.action?.['sections'] as Array<{ rows?: unknown[]; title?: string }> | undefined
    if (!Array.isArray(sections)) issues.push('$.interactive.action.sections: required for list')
    else {
      const rows = sections.reduce((n, s) => n + (Array.isArray(s.rows) ? s.rows.length : 0), 0)
      if (rows > 10) issues.push(`$.interactive.action.sections: at most 10 rows in total (${rows})`)
      if (sections.length > 1 && sections.some((s) => !s.title)) issues.push('$.interactive.action.sections[].title: required when there is more than one section')
    }
    if (typeof inter.action?.['button'] !== 'string') issues.push('$.interactive.action.button: required for list')
  }
  return issues
}

/** Upload limits per MIME family (Cloud API "Supported media types"). */
function uploadLimit(mime: string): number {
  if (mime === 'image/webp') return 500 * 1024
  if (mime.startsWith('image/')) return 5 * 1024 * 1024
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 16 * 1024 * 1024
  return 100 * 1024 * 1024
}

function wamid(): string {
  return `wamid.HBgL${randomBytes(24).toString('base64url')}`
}

export class WhatsAppSimulator extends PlatformSimulator {
  readonly channel = 'whatsapp' as const
  readonly title = 'WhatsApp Cloud API'
  readonly accessToken: string
  readonly appSecret: string
  readonly verifyToken: string
  readonly phoneNumberId: string
  readonly displayPhoneNumber: string
  readonly wabaId: string
  /** wa_id → profile name, for the `contacts` array of webhooks. */
  private readonly names = new Map<string, string>()

  constructor(options: WhatsAppSimulatorOptions = {}) {
    super(options, { id: '15551234567', name: 'Sandbox User' })
    this.accessToken = options.accessToken ?? 'sandbox-whatsapp-token'
    this.appSecret = options.appSecret ?? 'sandbox-whatsapp-app-secret'
    this.verifyToken = options.verifyToken ?? 'sandbox-verify-token'
    this.phoneNumberId = options.phoneNumberId ?? '109876543210987'
    this.displayPhoneNumber = options.displayPhoneNumber ?? '15550001111'
    this.wabaId = options.wabaId ?? '102938475610293'
  }

  /** Config for `new CloudAPIProvider(...)` pointing at this simulator. */
  providerConfig(): { accessToken: string; phoneNumberId: string; verifyToken: string; appSecret: string; graphUrl: string; wabaId: string; mediaDownload: { allowHttp: true; allowPrivateHosts: true } } {
    return {
      accessToken: this.accessToken,
      phoneNumberId: this.phoneNumberId,
      verifyToken: this.verifyToken,
      appSecret: this.appSecret,
      graphUrl: this.url,
      wabaId: this.wabaId,
      mediaDownload: { allowHttp: true, allowPrivateHosts: true },
    }
  }

  private readonly auth = (req: SimRequest): boolean => bearer(req) === this.accessToken

  protected routes(): void {
    // Media bytes ("lookaside" CDN): needs the same bearer token, like Meta's.
    this.api('GET', '/whatsapp/media/:id', (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 404, body: 'URL signature expired' }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    }, { auth: this.auth })

    this.api('POST', '/:ver/:phoneId/messages', (req) => this.onMessage(req), {
      send: true,
      auth: this.auth,
      schema: (req) => ({ schema: WHATSAPP_MESSAGE_SCHEMA, value: req.json() }),
      check: (req) => {
        const issues: string[] = []
        if (req.params['phoneId'] !== this.phoneNumberId) issues.push(`path: unknown phone number id ${req.params['phoneId']}`)
        const body = req.json()
        if (body && typeof body === 'object') issues.push(...messageRules(body as Record<string, unknown>))
        return issues
      },
    })

    this.api('POST', '/:ver/:phoneId/media', async (req) => {
      const form = await req.multipart()
      const file = form.get('file')
      if (!(file instanceof Blob)) return graphError({ status: 400, code: 100, message: '(#100) The parameter file is required.' })
      const mime = String(form.get('type') ?? file.type ?? 'application/octet-stream')
      const data = Buffer.from(await file.arrayBuffer())
      if (data.length > uploadLimit(mime)) return graphFault('mediaTooLarge', 0, 'whatsapp')
      const item = this.media.put(data, { mimetype: mime, origin: 'bot', id: ids.digits(16), ...(file instanceof File && file.name ? { filename: file.name } : {}) })
      return { status: 200, body: { id: item.id } }
    }, {
      send: true,
      auth: this.auth,
      check: async (req) => {
        const form = await req.multipart().catch(() => undefined)
        if (!form) return ['body: not multipart/form-data']
        const issues: string[] = []
        if (form.get('messaging_product') !== 'whatsapp') issues.push('messaging_product: must be whatsapp')
        if (typeof form.get('type') !== 'string') issues.push('type: required (MIME type)')
        else if (form.get('type') === 'application/octet-stream') issues.push('type: application/octet-stream is not a supported media type')
        if (!(form.get('file') instanceof Blob)) issues.push('file: required')
        return issues
      },
    })

    this.api('GET', '/:ver/:mediaId', (req) => {
      const item = this.media.peek(req.params['mediaId']!)
      if (!item) return graphError({ status: 400, code: 100, subcode: 33, message: `Unsupported get request. Object with ID '${req.params['mediaId']}' does not exist` })
      return {
        status: 200,
        body: {
          messaging_product: 'whatsapp',
          url: `${this.url}/whatsapp/media/${item.id}`,
          mime_type: item.mimetype,
          sha256: item.sha256,
          file_size: item.data.length,
          id: item.id,
        },
      }
    }, { auth: this.auth })
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    return graphFault(kind, retryAfterSec, 'whatsapp')
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return graphInvalid(issues)
  }

  protected notFound(req: SimRequest): SimResponse {
    return graphError({ status: 400, code: 100, subcode: 33, message: `Unsupported ${req.method.toLowerCase()} request.` })
  }

  private onMessage(req: SimRequest): SimResponse {
    const body = req.json() as Record<string, unknown>
    if (body['status'] === 'read') {
      this.recordOutbound({ id: '', chatId: '', kind: 'action', action: body['typing_indicator'] ? 'read+typing' : 'read', targetId: String(body['message_id']), raw: body })
      return { status: 200, body: { success: true } }
    }
    const to = String(body['to'] ?? body['recipient'])
    const id = wamid()
    this.recordOutbound({ id, chatId: to, ...describeOutbound(body), raw: body })
    return {
      status: 200,
      body: { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id, ...(body['type'] === 'template' ? { message_status: 'accepted' } : {}) }] },
    }
  }

  /* --- inbound ---------------------------------------------------------- */

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    if (user.name) this.names.set(user.id, user.name)
    const id = input.id ?? wamid()
    const at = input.at ?? Date.now()
    const msg: Record<string, unknown> = { from: user.id, id, timestamp: String(Math.floor(at / 1000)) }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.quotedId) msg['context'] = { from: this.displayPhoneNumber, id: input.quotedId }
    if (input.text !== undefined) {
      msg['type'] = 'text'
      msg['text'] = { body: input.text }
      text = input.text
    } else if (input.media) {
      const m = input.media
      const mimetype = m.mimetype ?? KIND_MIME[m.kind] ?? 'application/octet-stream'
      const item = this.media.put(m.data, { mimetype, id: ids.digits(16), ...(m.filename ? { filename: m.filename } : {}) })
      const type = m.kind === 'voice' ? 'audio' : m.kind
      msg['type'] = type
      msg[type] = {
        id: item.id,
        mime_type: mimetype,
        sha256: item.sha256,
        ...(m.caption ? { caption: m.caption } : {}),
        ...(m.filename && m.kind === 'document' ? { filename: m.filename } : {}),
        ...(m.kind === 'voice' ? { voice: true } : {}),
      }
      kind = m.kind
      text = m.caption
    } else if (input.location) {
      msg['type'] = 'location'
      msg['location'] = { ...input.location }
      kind = 'location'
    } else if (input.reply) {
      const r = input.reply
      msg['type'] = 'interactive'
      msg['interactive'] = r.kind === 'button'
        ? { type: 'button_reply', button_reply: { id: r.id, title: r.title ?? r.id } }
        : { type: 'list_reply', list_reply: { id: r.id, title: r.title ?? r.id } }
      msg['context'] = { from: this.displayPhoneNumber, id: r.messageId ?? this.lastOutboundId() ?? wamid() }
      kind = r.kind
      text = r.title ?? r.id
    } else {
      throw new Error('WhatsApp Cloud API simulator: send text, media, location or a button/list reply (edits and polls are not delivered by the Cloud API)')
    }
    const payload = this.envelope({
      contacts: [{ profile: { name: this.names.get(user.id) ?? user.name ?? '' }, wa_id: user.id }],
      messages: [msg],
    })
    return { id, chatId: user.id, record: { id, channel: this.channel, chatId: user.id, user, kind, ...(text !== undefined ? { text } : {}), at }, payload }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    const deliveries = await this.post(prepared.payload)
    return { id: prepared.id, chatId: prepared.chatId, deliveries }
  }

  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    const recipient = out?.chatId ?? this.defaultUser.id
    const st: Record<string, unknown> = {
      id: messageId,
      status,
      timestamp: String(Math.floor(Date.now() / 1000)),
      recipient_id: recipient,
      ...(status !== 'read' && status !== 'failed'
        ? {
            conversation: { id: ids.hex(16), origin: { type: 'service' } },
            pricing: { billable: false, pricing_model: 'PMP', category: 'service', type: 'free_customer_service' },
          }
        : {}),
      ...(status === 'failed' ? { errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable' }] } : {}),
    }
    this.recordInbound({ id: messageId, channel: this.channel, chatId: recipient, user: { id: recipient }, kind: 'status', text: status, at: Date.now() })
    const deliveries = await this.post(this.envelope({ statuses: [st] }))
    return { id: messageId, chatId: recipient, deliveries }
  }

  /** Deliver an arbitrary (already built) webhook body, signed. */
  async post(payload: unknown, opts: { signature?: string | false } = {}): Promise<SendOutcome['deliveries']> {
    const raw = JSON.stringify(payload)
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'facebookexternalua' }
    if (opts.signature !== false) headers['x-hub-signature-256'] = opts.signature ?? hubSignature(this.appSecret, raw)
    return this.postWebhook(raw, headers)
  }

  /** GET subscription handshake (`hub.challenge`) against the bot's webhook URL. */
  async verifySubscription(verifyToken = this.verifyToken): Promise<{ status: number; ok: boolean }> {
    if (!this.webhookUrl) throw new Error('setWebhook(url) first')
    return verifySubscription(this.webhookUrl, verifyToken)
  }

  private envelope(value: Record<string, unknown>): unknown {
    return {
      object: 'whatsapp_business_account',
      entry: [{
        id: this.wabaId,
        changes: [{
          field: 'messages',
          value: { messaging_product: 'whatsapp', metadata: { display_phone_number: this.displayPhoneNumber, phone_number_id: this.phoneNumberId }, ...value },
        }],
      }],
    }
  }

  private lastOutboundId(): string | undefined {
    for (let i = this.outbox.length - 1; i >= 0; i--) if (this.outbox[i]!.id) return this.outbox[i]!.id
    return undefined
  }
}

/** Normalize a Cloud API message body into an {@link OutboundRecord} view. */
function describeOutbound(body: Record<string, unknown>): Omit<OutboundRecord, 'id' | 'chatId' | 'channel' | 'raw' | 'at'> {
  const type = String(body['type'] ?? 'text')
  const get = (k: string) => (body[k] ?? {}) as Record<string, unknown>
  switch (type) {
    case 'text':
      return { kind: 'text', text: String(get('text')['body'] ?? '') }
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      const m = get(type)
      return {
        kind: type as OutboundRecord['kind'],
        ...(typeof m['caption'] === 'string' ? { caption: m['caption'], text: m['caption'] } : {}),
        media: {
          ...(typeof m['link'] === 'string' ? { url: m['link'] } : {}),
          ...(typeof m['id'] === 'string' ? { mediaId: m['id'] } : {}),
          ...(typeof m['filename'] === 'string' ? { filename: m['filename'] } : {}),
        },
      }
    }
    case 'location': {
      const l = get('location')
      return { kind: 'location', location: { latitude: Number(l['latitude']), longitude: Number(l['longitude']), ...(l['name'] ? { name: String(l['name']) } : {}), ...(l['address'] ? { address: String(l['address']) } : {}) } }
    }
    case 'contacts': {
      const c = (body['contacts'] as Array<{ name?: { formatted_name?: string } }>)[0]
      return { kind: 'contact', text: c?.name?.formatted_name ?? '' }
    }
    case 'reaction': {
      const r = get('reaction')
      return { kind: 'reaction', text: String(r['emoji'] ?? ''), targetId: String(r['message_id'] ?? '') }
    }
    case 'template': {
      const t = get('template')
      return { kind: 'template', template: { name: String(t['name']), language: String((t['language'] as { code?: string } | undefined)?.code ?? ''), params: t['components'] } }
    }
    case 'interactive': {
      const i = get('interactive') as { type?: string; body?: { text?: string }; action?: Record<string, unknown> }
      const text = i.body?.text
      if (i.type === 'button') {
        const buttons = (i.action?.['buttons'] as Array<{ reply: { id: string; title: string } }> | undefined) ?? []
        return { kind: 'buttons', ...(text ? { text } : {}), buttons: buttons.map((b) => ({ id: b.reply.id, title: b.reply.title })) }
      }
      if (i.type === 'cta_url') {
        const p = (i.action?.['parameters'] ?? {}) as { display_text?: string; url?: string }
        return { kind: 'buttons', ...(text ? { text } : {}), buttons: [{ id: '', title: p.display_text ?? '', ...(p.url ? { url: p.url } : {}) }] }
      }
      if (i.type === 'list') {
        const sections = (i.action?.['sections'] as Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }> | undefined) ?? []
        return { kind: 'list', ...(text ? { text } : {}), sections: sections.map((s) => ({ ...(s.title ? { title: s.title } : {}), rows: s.rows })) }
      }
      return { kind: 'unknown', ...(text ? { text } : {}) }
    }
    default:
      return { kind: 'unknown' }
  }
}
