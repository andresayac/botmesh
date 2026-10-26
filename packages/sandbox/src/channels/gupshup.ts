/**
 * Gupshup WhatsApp API simulator. Implements the v1 send endpoints
 * `@botmesh/gupshup` calls (`POST /wa/api/v1/msg` and
 * `/wa/api/v1/template/msg`, form-encoded with the `apikey` header), hosts
 * inbound media on expiring file-manager URLs and delivers v2 callbacks
 * (`message` and `message-event`). Gupshup does not sign callbacks: the shared
 * token travels in a header (or the query string) as the provider expects.
 *
 * Message JSON shapes follow Gupshup's "Send message" reference (text, image
 * `originalUrl`/`previewUrl`, video/audio/file/sticker `url`, location,
 * contact, `quick_reply` with up to 3 options of 20 chars, `list` with one
 * global button and up to 10 rows).
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
import { KIND_MIME } from '../sim/media.js'
import type { Schema } from '../sim/validate.js'
import { validate } from '../sim/validate.js'

export interface GupshupSimulatorOptions extends BaseSimulatorOptions {
  apiKey?: string
  appName?: string
  /** Business number (digits). */
  source?: string
  /** Shared callback token. */
  webhookToken?: string
  /** Where callbacks carry the token: `'header'` (`x-webhook-token`, default) or `'query'` (`?token=`). */
  tokenIn?: 'header' | 'query'
}

const option: Schema = { type: 'object', required: ['type', 'title'], properties: { type: { const: 'text' }, title: { type: 'string', minLength: 1, maxLength: 24 }, description: { type: 'string', maxLength: 72 }, postbackText: { type: 'string', maxLength: 256 } } }

/** The `message` JSON of `/wa/api/v1/msg`. */
export const GUPSHUP_MESSAGE_SCHEMA: Schema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { enum: ['text', 'image', 'video', 'audio', 'file', 'sticker', 'location', 'contact', 'quick_reply', 'list'] },
    text: { type: 'string', minLength: 1, maxLength: 4096 },
    previewUrl: { type: ['string', 'boolean'] },
    originalUrl: { type: 'string', pattern: '^https?://' },
    url: { type: 'string', pattern: '^https?://' },
    caption: { type: 'string', maxLength: 1024 },
    filename: { type: 'string' },
    longitude: { type: ['number', 'string'] },
    latitude: { type: ['number', 'string'] },
    name: { type: 'string' },
    address: { type: 'string' },
    contact: { type: 'object' },
    msgid: { type: 'string' },
    content: { type: 'object', required: ['type'], properties: { type: { enum: ['text', 'image', 'video', 'file'] }, text: { type: 'string', maxLength: 1024 }, header: { type: 'string', maxLength: 60 }, caption: { type: 'string', maxLength: 60 } } },
    options: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', required: ['type', 'title'], properties: { type: { const: 'text' }, title: { type: 'string', minLength: 1, maxLength: 20 }, postbackText: { type: 'string' } } } },
    title: { type: 'string', maxLength: 60 },
    body: { type: 'string', minLength: 1, maxLength: 1024 },
    footer: { type: 'string', maxLength: 60 },
    globalButtons: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', required: ['type', 'title'], properties: { type: { const: 'text' }, title: { type: 'string', minLength: 1, maxLength: 20 } } } },
    items: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['options'], properties: { title: { type: 'string', maxLength: 24 }, subtitle: { type: 'string' }, options: { type: 'array', minItems: 1, maxItems: 10, items: option } } } },
  },
}

function messageRules(m: Record<string, unknown>): string[] {
  const issues: string[] = []
  const need = (k: string) => { if (m[k] === undefined) issues.push(`message.${k}: required for type ${String(m['type'])}`) }
  switch (m['type']) {
    case 'text': need('text'); break
    case 'image': need('originalUrl'); need('previewUrl'); break
    case 'video': case 'audio': case 'sticker': need('url'); break
    case 'file': need('url'); need('filename'); break
    case 'location': need('longitude'); need('latitude'); break
    case 'contact': need('contact'); break
    case 'quick_reply': need('content'); need('options'); break
    case 'list': {
      need('body'); need('globalButtons'); need('items')
      const rows = Array.isArray(m['items']) ? (m['items'] as Array<{ options?: unknown[] }>).reduce((n, i) => n + (i.options?.length ?? 0), 0) : 0
      if (rows > 10) issues.push(`message.items: at most 10 rows in total (${rows})`)
      break
    }
  }
  return issues
}

export class GupshupSimulator extends PlatformSimulator {
  readonly channel = 'gupshup' as const
  readonly title = 'Gupshup (WhatsApp)'
  readonly apiKey: string
  readonly appName: string
  readonly source: string
  readonly webhookToken: string
  private readonly tokenIn: 'header' | 'query'

  constructor(options: GupshupSimulatorOptions = {}) {
    super(options, { id: '573001112233', name: 'Sandbox User' })
    this.apiKey = options.apiKey ?? 'sandbox-gupshup-api-key'
    this.appName = options.appName ?? 'SandboxApp'
    this.source = options.source ?? '917834811114'
    this.webhookToken = options.webhookToken ?? 'sandbox-gupshup-callback-token'
    this.tokenIn = options.tokenIn ?? 'header'
  }

  providerConfig(): { apiKey: string; appName: string; source: string; baseUrl: string; webhookToken: string; http: { allowHttp: true; allowPrivateHosts: true } } {
    return { apiKey: this.apiKey, appName: this.appName, source: this.source, baseUrl: this.url, webhookToken: this.webhookToken, http: { allowHttp: true, allowPrivateHosts: true } }
  }

  private readonly auth = (req: SimRequest): boolean => req.header('apikey') === this.apiKey

  protected routes(): void {
    this.api('GET', '/gupshup/files/:id', (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 404, body: { status: 'error', message: 'File not found or link expired' } }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    this.api('POST', '/wa/api/v1/msg', (req) => this.onSend(req, false), { send: true, auth: this.auth, check: (req) => this.checkForm(req, false) })
    this.api('POST', '/wa/api/v1/template/msg', (req) => this.onSend(req, true), { send: true, auth: this.auth, check: (req) => this.checkForm(req, true) })
  }

  private checkForm(req: SimRequest, template: boolean): string[] {
    const f = req.form()
    const issues: string[] = []
    if (!(req.header('content-type') ?? '').includes('application/x-www-form-urlencoded')) issues.push('Content-Type: must be application/x-www-form-urlencoded')
    if (!template && f.get('channel') !== 'whatsapp') issues.push('channel: must be whatsapp')
    if (f.get('source') !== this.source) issues.push(`source: not the app's number (${f.get('source')})`)
    if (!/^\d{8,15}$/.test(f.get('destination') ?? '')) issues.push(`destination: digits with country code expected (${f.get('destination')})`)
    if (f.get('src.name') !== this.appName) issues.push('src.name: must be the app name')
    const raw = template ? f.get('template') : f.get('message')
    let parsed: unknown
    try { parsed = raw === null ? undefined : JSON.parse(raw) } catch { issues.push(`${template ? 'template' : 'message'}: not JSON`) }
    if (parsed === undefined) issues.push(`${template ? 'template' : 'message'}: required`)
    else if (template) {
      const t = parsed as { id?: unknown; params?: unknown }
      if (typeof t.id !== 'string' || !t.id) issues.push('template.id: required')
      if (t.params !== undefined && !Array.isArray(t.params)) issues.push('template.params: must be an array')
    } else {
      issues.push(...validate(GUPSHUP_MESSAGE_SCHEMA, parsed, 'message'), ...messageRules(parsed as Record<string, unknown>))
    }
    return issues
  }

  private onSend(req: SimRequest, template: boolean): SimResponse {
    const f = req.form()
    const to = f.get('destination')!
    const id = ids.hex(4) + '-' + ids.hex(2) + '-' + ids.hex(2) + '-' + ids.hex(2) + '-' + ids.hex(6)
    if (template) {
      const t = JSON.parse(f.get('template')!) as { id: string; params?: string[] }
      this.recordOutbound({ id, chatId: to, kind: 'template', template: { name: t.id, params: t.params }, raw: Object.fromEntries(f) })
    } else {
      this.recordOutbound({ id, chatId: to, ...describe(JSON.parse(f.get('message')!) as Record<string, unknown>), raw: Object.fromEntries(f) })
    }
    return { status: 202, body: { status: 'submitted', messageId: id } }
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    const err = (status: number, message: string, headers: Record<string, string> = {}): SimResponse => ({ status, headers, body: { status: 'error', message } })
    switch (kind) {
      case 'rateLimit': return err(429, 'Too Many Requests', { 'retry-after': String(retryAfterSec) })
      case 'invalidRecipient': return err(400, 'Invalid Destination')
      case 'outsideWindow': return err(400, 'Message failed to send because more than 24 hours have passed since the customer last replied to this number')
      case 'mediaTooLarge': return err(400, 'Media file size exceeds the size limit')
      case 'auth': return err(401, 'Authentication Failed')
      case 'serverError': return err(500, 'Internal Server Error')
    }
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return { status: 400, body: { status: 'error', message: `Invalid request: ${issues.slice(0, 3).join('; ')}` } }
  }

  /* --- inbound ---------------------------------------------------------- */

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const id = input.id ?? `ABEGkZZ${ids.upperHex(10)}`
    let type: string
    let inner: Record<string, unknown>
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.text !== undefined) {
      type = 'text'
      inner = { text: input.text }
      text = input.text
    } else if (input.media) {
      const m = input.media
      const mimetype = m.mimetype ?? KIND_MIME[m.kind] ?? 'application/octet-stream'
      const item = this.media.put(m.data, { mimetype, ...(m.filename ? { filename: m.filename } : {}) })
      type = m.kind === 'document' ? 'file' : m.kind === 'voice' ? 'audio' : m.kind
      inner = {
        url: `${this.url}/gupshup/files/${item.id}?download=false`,
        contentType: mimetype,
        urlExpiry: item.expiresAt ?? at + 86_400_000,
        ...(m.caption ? { caption: m.caption } : {}),
        ...(m.filename ? { name: m.filename } : {}),
      }
      kind = m.kind
      text = m.caption
    } else if (input.location) {
      type = 'location'
      inner = { latitude: String(input.location.latitude), longitude: String(input.location.longitude), ...(input.location.name ? { name: input.location.name } : {}), ...(input.location.address ? { address: input.location.address } : {}) }
      kind = 'location'
    } else if (input.reply) {
      const r = input.reply
      type = r.kind === 'button' ? 'button_reply' : 'list_reply'
      inner = { title: r.title ?? r.id, id: r.id, reply: `${r.title ?? r.id} 1`, postbackText: r.id }
      kind = r.kind
      text = r.title ?? r.id
    } else {
      throw new Error('Gupshup simulator: send text, media, location or a button/list reply')
    }
    const payload = {
      app: this.appName,
      timestamp: at,
      version: 2,
      type: 'message',
      payload: {
        id,
        source: user.id,
        type,
        payload: inner,
        sender: { phone: user.id, name: user.name ?? '', country_code: user.id.slice(0, 2), dial_code: user.id.slice(2) },
        ...(input.quotedId ? { context: { id: input.quotedId, gsId: input.quotedId } } : {}),
      },
    }
    return { id, chatId: user.id, record: { id, channel: this.channel, chatId: user.id, user, kind, ...(text !== undefined ? { text } : {}), at }, payload }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    return { id: prepared.id, chatId: prepared.chatId, deliveries: await this.post(prepared.payload) }
  }

  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    const to = out?.chatId ?? this.defaultUser.id
    const at = Date.now()
    const payload = {
      app: this.appName,
      timestamp: at,
      version: 2,
      type: 'message-event',
      payload: {
        id: `wamid.${ids.hex(16)}`,
        gsId: messageId,
        type: status === 'sent' ? 'sent' : status,
        destination: to,
        payload: status === 'failed' ? { code: 1002, reason: 'Number Does Not Exists On WhatsApp' } : { ts: Math.floor(at / 1000) },
      },
    }
    this.recordInbound({ id: messageId, channel: this.channel, chatId: to, user: { id: to }, kind: 'status', text: status, at })
    return { id: messageId, chatId: to, deliveries: await this.post(payload) }
  }

  /** POST a callback to the bot with the shared token (`token: false` omits it). */
  async post(payload: unknown, opts: { token?: string | false } = {}): Promise<SendOutcome['deliveries']> {
    if (!this.webhookUrl) throw new Error('setWebhook(url) first')
    const token = opts.token === false ? undefined : opts.token ?? this.webhookToken
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Gupshup-Callback' }
    let url = this.webhookUrl
    if (token !== undefined) {
      if (this.tokenIn === 'header') headers['x-webhook-token'] = token
      else {
        const u = new URL(url)
        u.searchParams.set('token', token)
        url = u.toString()
      }
    }
    return this.postWebhook(JSON.stringify(payload), headers, url)
  }
}

function describe(m: Record<string, unknown>): Omit<OutboundRecord, 'id' | 'chatId' | 'channel' | 'raw' | 'at'> {
  const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined)
  switch (m['type']) {
    case 'text': return { kind: 'text', text: s('text') ?? '' }
    case 'image': return { kind: 'image', ...(s('caption') ? { caption: s('caption')!, text: s('caption')! } : {}), media: { url: s('originalUrl') ?? '' } }
    case 'video': return { kind: 'video', ...(s('caption') ? { caption: s('caption')!, text: s('caption')! } : {}), media: { url: s('url') ?? '' } }
    case 'audio': return { kind: 'audio', media: { url: s('url') ?? '' } }
    case 'sticker': return { kind: 'sticker', media: { url: s('url') ?? '' } }
    case 'file': return { kind: 'document', ...(s('caption') ? { caption: s('caption')!, text: s('caption')! } : {}), media: { url: s('url') ?? '', ...(s('filename') ? { filename: s('filename')! } : {}) } }
    case 'location': return { kind: 'location', location: { latitude: Number(m['latitude']), longitude: Number(m['longitude']), ...(s('name') ? { name: s('name')! } : {}), ...(s('address') ? { address: s('address')! } : {}) } }
    case 'contact': return { kind: 'contact', text: String(((m['contact'] as { name?: { formattedName?: string } })?.name?.formattedName) ?? '') }
    case 'quick_reply': {
      const content = (m['content'] ?? {}) as { text?: string }
      const options = (m['options'] as Array<{ title: string; postbackText?: string }> | undefined) ?? []
      return { kind: 'buttons', text: content.text ?? '', buttons: options.map((o) => ({ id: o.postbackText ?? o.title, title: o.title })) }
    }
    case 'list': {
      const items = (m['items'] as Array<{ title?: string; options: Array<{ title: string; description?: string; postbackText?: string }> }> | undefined) ?? []
      return {
        kind: 'list',
        text: s('body') ?? '',
        sections: items.map((i) => ({ ...(i.title ? { title: i.title } : {}), rows: i.options.map((o) => ({ id: o.postbackText ?? o.title, title: o.title, ...(o.description ? { description: o.description } : {}) })) })),
      }
    }
    default: return { kind: 'unknown' }
  }
}
