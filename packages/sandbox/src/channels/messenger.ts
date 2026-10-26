/**
 * Messenger Platform simulators: Facebook Messenger and Instagram DM. Both
 * implement the Send API (`POST /{version}/{page-id|me}/messages`) the
 * `@botmesh/messenger` and `@botmesh/instagram` providers call, host inbound
 * attachments on an expiring CDN URL, and deliver `page` / `instagram`
 * webhooks signed with `X-Hub-Signature-256`.
 *
 * Shapes and limits follow Meta's Send API reference: text 2000 (Messenger)
 * or 1000 (Instagram), 13 quick replies with 20-char titles, button template
 * with 3 buttons and 640-char text, generic template with 10 elements of
 * 80-char title/subtitle.
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

export interface MessengerSimulatorOptions extends BaseSimulatorOptions {
  accessToken?: string
  appSecret?: string
  verifyToken?: string
  /** Page id (Messenger) or Instagram professional account id. */
  pageId?: string
}

const button: Schema = {
  type: 'object', required: ['type', 'title'],
  properties: {
    type: { enum: ['postback', 'web_url', 'phone_number', 'account_link', 'account_unlink'] },
    title: { type: 'string', minLength: 1, maxLength: 20 },
    payload: { type: 'string', maxLength: 1000 },
    url: { type: 'string', pattern: '^https?://' },
  },
}

function sendSchema(textMax: number): Schema {
  return {
    type: 'object',
    required: ['recipient'],
    properties: {
      recipient: { type: 'object', properties: { id: { type: 'string', minLength: 1 }, user_ref: { type: 'string' }, comment_id: { type: 'string' }, post_id: { type: 'string' } } },
      messaging_type: { enum: ['RESPONSE', 'UPDATE', 'MESSAGE_TAG'] },
      tag: { enum: ['CONFIRMED_EVENT_UPDATE', 'POST_PURCHASE_UPDATE', 'ACCOUNT_UPDATE', 'HUMAN_AGENT'] },
      sender_action: { enum: ['mark_seen', 'typing_on', 'typing_off', 'react', 'unreact'] },
      message: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: textMax },
          quick_replies: {
            type: 'array', minItems: 1, maxItems: 13,
            items: {
              type: 'object', required: ['content_type'],
              properties: {
                content_type: { enum: ['text', 'user_phone_number', 'user_email'] },
                title: { type: 'string', maxLength: 20 },
                payload: { type: ['string', 'number'] },
                image_url: { type: 'string' },
              },
            },
          },
          attachment: {
            type: 'object', required: ['type', 'payload'],
            properties: {
              type: { enum: ['image', 'video', 'audio', 'file', 'template', 'like_heart', 'MEDIA_SHARE'] },
              payload: {
                type: 'object',
                properties: {
                  url: { type: 'string', pattern: '^https?://' },
                  is_reusable: { type: 'boolean' },
                  attachment_id: { type: 'string' },
                  template_type: { enum: ['generic', 'button', 'media', 'receipt', 'product', 'customer_feedback'] },
                  text: { type: 'string', minLength: 1, maxLength: 640 },
                  buttons: { type: 'array', minItems: 1, maxItems: 3, items: button },
                  elements: {
                    type: 'array', minItems: 1, maxItems: 10,
                    items: {
                      type: 'object', required: ['title'],
                      properties: {
                        title: { type: 'string', minLength: 1, maxLength: 80 },
                        subtitle: { type: 'string', maxLength: 80 },
                        image_url: { type: 'string' },
                        buttons: { type: 'array', maxItems: 3, items: button },
                      },
                    },
                  },
                },
              },
            },
          },
          metadata: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }
}

/** Exactly one of message / sender_action; a quick-reply message needs text. */
function sendRules(body: Record<string, unknown>, requireMessagingType: boolean): string[] {
  const issues: string[] = []
  if (requireMessagingType && body['message'] !== undefined && body['messaging_type'] === undefined) issues.push('$.messaging_type: required for messages (RESPONSE, UPDATE or MESSAGE_TAG)')
  if (body['messaging_type'] === 'MESSAGE_TAG' && body['tag'] === undefined) issues.push('$.tag: required with messaging_type MESSAGE_TAG')
  const hasMessage = body['message'] !== undefined
  const hasAction = body['sender_action'] !== undefined
  if (hasMessage === hasAction) issues.push('$: exactly one of message or sender_action')
  const recipient = body['recipient'] as Record<string, unknown> | undefined
  if (recipient && Object.keys(recipient).length !== 1) issues.push('$.recipient: exactly one recipient field')
  const message = body['message'] as Record<string, unknown> | undefined
  if (message) {
    if ((message['text'] === undefined) === (message['attachment'] === undefined)) issues.push('$.message: exactly one of text or attachment')
    const payload = (message['attachment'] as { type?: string; payload?: Record<string, unknown> } | undefined)
    if (payload?.type === 'template') {
      const t = payload.payload?.['template_type']
      if (t === 'button' && (!payload.payload?.['text'] || !payload.payload?.['buttons'])) issues.push('$.message.attachment.payload: button template needs text and buttons')
      if (t === 'generic' && !payload.payload?.['elements']) issues.push('$.message.attachment.payload: generic template needs elements')
    }
  }
  return issues
}

export class MessengerSimulator extends PlatformSimulator {
  readonly channel: 'messenger' | 'instagram' = 'messenger'
  readonly title: string = 'Facebook Messenger'
  readonly accessToken: string
  readonly appSecret: string
  readonly verifyToken: string
  readonly pageId: string
  protected readonly textMax: number = 2000

  constructor(options: MessengerSimulatorOptions = {}, defaultUser = { id: '24681357902468135', name: 'Sandbox User' }) {
    super(options, defaultUser)
    this.accessToken = options.accessToken ?? 'sandbox-page-token'
    this.appSecret = options.appSecret ?? 'sandbox-page-app-secret'
    this.verifyToken = options.verifyToken ?? 'sandbox-verify-token'
    this.pageId = options.pageId ?? '105551234567890'
  }

  /** Config for `new MessengerProvider(...)` / `new InstagramProvider(...)`. */
  providerConfig(): { accessToken: string; verifyToken: string; appSecret: string; graphUrl: string; selfId: string; mediaDownload: { allowHttp: true; allowPrivateHosts: true } } {
    return {
      accessToken: this.accessToken,
      verifyToken: this.verifyToken,
      appSecret: this.appSecret,
      graphUrl: this.url,
      selfId: this.pageId,
      mediaDownload: { allowHttp: true, allowPrivateHosts: true },
    }
  }

  protected get variant(): 'messenger' | 'instagram' {
    return this.channel
  }

  protected get webhookObject(): string {
    return 'page'
  }

  protected routes(): void {
    this.api('GET', `/${this.channel}/cdn/:id`, (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 403, body: 'URL signature expired' }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    const schema = sendSchema(this.textMax)
    this.api('POST', '/:ver/:node/messages', (req) => this.onSend(req), {
      send: true,
      auth: (req) => bearer(req) === this.accessToken || req.query.get('access_token') === this.accessToken,
      schema: (req) => ({ schema, value: req.json() }),
      check: (req) => {
        const issues: string[] = []
        const node = req.params['node']
        if (node !== 'me' && node !== this.pageId) issues.push(`path: unknown node ${node}`)
        const body = req.json()
        if (body && typeof body === 'object') issues.push(...sendRules(body as Record<string, unknown>, this.channel === 'messenger'))
        return issues
      },
    })
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    return graphFault(kind, retryAfterSec, this.variant)
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return graphInvalid(issues)
  }

  protected notFound(req: SimRequest): SimResponse {
    return graphError({ status: 400, code: 100, subcode: 33, message: `Unsupported ${req.method.toLowerCase()} request.` })
  }

  private onSend(req: SimRequest): SimResponse {
    const body = req.json() as { recipient: { id: string }; message?: Record<string, unknown>; sender_action?: string }
    const chatId = body.recipient.id
    if (body.sender_action) {
      this.recordOutbound({ id: '', chatId, kind: 'action', action: body.sender_action, raw: body })
      return { status: 200, body: { recipient_id: chatId } }
    }
    const id = `m_${randomBytes(30).toString('base64url')}`
    this.recordOutbound({ id, chatId, ...describeSend(body.message ?? {}), raw: body })
    return { status: 200, body: { recipient_id: chatId, message_id: id } }
  }

  /* --- inbound ---------------------------------------------------------- */

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const mid = input.id ?? `m_${randomBytes(30).toString('base64url')}`
    const event: Record<string, unknown> = { sender: { id: user.id }, recipient: { id: this.pageId }, timestamp: at }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.text !== undefined) {
      event['message'] = { mid, text: input.text, ...(input.quotedId ? { reply_to: { mid: input.quotedId } } : {}) }
      text = input.text
    } else if (input.media) {
      const m = input.media
      const mimetype = m.mimetype ?? KIND_MIME[m.kind] ?? 'application/octet-stream'
      const item = this.media.put(m.data, { mimetype, ...(m.filename ? { filename: m.filename } : {}) })
      const type = m.kind === 'document' ? 'file' : m.kind === 'voice' ? 'audio' : m.kind === 'sticker' ? 'image' : m.kind
      const url = `${this.url}/${this.channel}/cdn/${item.id}?oh=${ids.hex(16)}&oe=${Math.floor((item.expiresAt ?? at + 3_600_000) / 1000).toString(16)}`
      event['message'] = { mid, attachments: [{ type, payload: { url } }] }
      kind = m.kind
    } else if (input.location) {
      const l = input.location
      event['message'] = { mid, attachments: [{ type: 'location', title: l.name ?? 'Location', payload: { coordinates: { lat: l.latitude, long: l.longitude }, ...(l.name ? { title: l.name } : {}) } }] }
      kind = 'location'
    } else if (input.reply) {
      this.replyEvent(event, mid, input.reply)
      kind = input.reply.kind
      text = input.reply.title ?? input.reply.id
    } else if (input.edit) {
      event['message_edit'] = { mid: input.edit.messageId, text: input.edit.text, num_edit: 1 }
      kind = 'edit'
      text = input.edit.text
    } else {
      throw new Error(`${this.title} simulator: send text, media, location, a reply or an edit`)
    }
    const payload = { object: this.webhookObject, entry: [{ id: this.pageId, time: at, messaging: [event] }] }
    return { id: mid, chatId: user.id, record: { id: mid, channel: this.channel, chatId: user.id, user, kind, ...(text !== undefined ? { text } : {}), at }, payload }
  }

  /** Messenger: a button template / generic template tap is a `postback`. */
  protected replyEvent(event: Record<string, unknown>, mid: string, reply: NonNullable<UserInput['reply']>): void {
    const last = [...this.outbox].reverse().find((o) => o.kind === 'buttons' || o.kind === 'list')
    if (last?.raw && JSON.stringify(last.raw).includes('quick_replies')) {
      event['message'] = { mid, text: reply.title ?? reply.id, quick_reply: { payload: reply.id } }
      return
    }
    event['postback'] = { mid, title: reply.title ?? reply.id, payload: reply.id }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    return { id: prepared.id, chatId: prepared.chatId, deliveries: await this.post(prepared.payload) }
  }

  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    const chatId = out?.chatId ?? this.defaultUser.id
    const at = Date.now()
    const event: Record<string, unknown> = { sender: { id: chatId }, recipient: { id: this.pageId }, timestamp: at }
    if (status === 'read') event['read'] = this.channel === 'instagram' ? { mid: messageId } : { watermark: at }
    else event['delivery'] = { mids: [messageId], watermark: at }
    this.recordInbound({ id: messageId, channel: this.channel, chatId, user: { id: chatId }, kind: 'status', text: status, at })
    const payload = { object: this.webhookObject, entry: [{ id: this.pageId, time: at, messaging: [event] }] }
    return { id: messageId, chatId, deliveries: await this.post(payload) }
  }

  /** Deliver a webhook body (signed unless `signature: false`). */
  async post(payload: unknown, opts: { signature?: string | false } = {}): Promise<SendOutcome['deliveries']> {
    const raw = JSON.stringify(payload)
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'facebookexternalua' }
    if (opts.signature !== false) headers['x-hub-signature-256'] = opts.signature ?? hubSignature(this.appSecret, raw)
    return this.postWebhook(raw, headers)
  }

  async verifySubscription(verifyToken = this.verifyToken): Promise<{ status: number; ok: boolean }> {
    if (!this.webhookUrl) throw new Error('setWebhook(url) first')
    return verifySubscription(this.webhookUrl, verifyToken)
  }
}

export class InstagramSimulator extends MessengerSimulator {
  override readonly channel = 'instagram' as const
  override readonly title = 'Instagram DM'
  protected override readonly textMax = 1000

  constructor(options: MessengerSimulatorOptions = {}) {
    super({ pageId: '17841400000000000', accessToken: 'sandbox-instagram-token', appSecret: 'sandbox-instagram-app-secret', ...options }, { id: '1234567890123456', name: 'sandbox.user' })
  }

  protected override get webhookObject(): string {
    return 'instagram'
  }

  /** Instagram: quick replies come back as a message with `quick_reply`; generic template taps as `postback`. */
  protected override replyEvent(event: Record<string, unknown>, mid: string, reply: NonNullable<UserInput['reply']>): void {
    event['message'] = { mid, text: reply.title ?? reply.id, quick_reply: { payload: reply.id } }
  }
}

function describeSend(message: Record<string, unknown>): Omit<OutboundRecord, 'id' | 'chatId' | 'channel' | 'raw' | 'at'> {
  const quick = message['quick_replies'] as Array<{ title?: string; payload?: string }> | undefined
  if (typeof message['text'] === 'string') {
    if (quick?.length) return { kind: 'buttons', text: message['text'], buttons: quick.map((q) => ({ id: String(q.payload ?? q.title ?? ''), title: q.title ?? '' })) }
    return { kind: 'text', text: message['text'] }
  }
  const att = message['attachment'] as { type?: string; payload?: Record<string, unknown> } | undefined
  if (!att) return { kind: 'unknown' }
  const p = att.payload ?? {}
  if (att.type === 'template') {
    const toButtons = (bs: unknown) => ((bs as Array<{ title: string; payload?: string; url?: string }> | undefined) ?? []).map((b) => ({ id: b.payload ?? '', title: b.title, ...(b.url ? { url: b.url } : {}) }))
    if (p['template_type'] === 'button') return { kind: 'buttons', text: String(p['text'] ?? ''), buttons: toButtons(p['buttons']) }
    if (p['template_type'] === 'generic') {
      const elements = (p['elements'] as Array<{ title: string; subtitle?: string; buttons?: unknown }> | undefined) ?? []
      return {
        kind: 'list',
        sections: [{ rows: elements.map((e) => ({ id: toButtons(e.buttons)[0]?.id ?? e.title, title: e.title, ...(e.subtitle ? { description: e.subtitle } : {}) })) }],
      }
    }
    return { kind: 'card' }
  }
  const kind = att.type === 'file' ? 'document' : (att.type as OutboundRecord['kind'])
  return { kind: ['image', 'video', 'audio', 'document'].includes(kind) ? kind : 'unknown', media: { ...(typeof p['url'] === 'string' ? { url: p['url'] } : {}) } }
}
