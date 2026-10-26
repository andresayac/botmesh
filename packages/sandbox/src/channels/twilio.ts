/**
 * Twilio Programmable Messaging simulator (WhatsApp and SMS). Implements
 * `POST /2010-04-01/Accounts/{AccountSid}/Messages.json` (form-encoded, Basic
 * auth), the media sub-resource with its redirect to the CDN, and the v3
 * typing indicator; delivers form webhooks and status callbacks signed with
 * `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted params, the documented
 * algorithm).
 *
 * Request parameters follow the twilio-oai `twilio_api_v2010` document
 * (`CreateMessageRequest`): `To` is required, plus `From` or
 * `MessagingServiceSid`, plus one of `Body`, `MediaUrl` or `ContentSid`;
 * `Body` is at most 1600 characters and `MediaUrl` at most 10 entries. The
 * form is also validated against that schema as vendored from twilio-oai
 * (`src/specs/twilio.ts`, issues tagged `[openapi]`).
 */

import { createHmac } from 'node:crypto'
import {
  PlatformSimulator,
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
import { formToObject, validate } from '../sim/validate.js'
import { TWILIO_CREATE_MESSAGE_OPENAPI } from '../specs/twilio.js'

export interface TwilioSimulatorOptions extends BaseSimulatorOptions {
  accountSid?: string
  authToken?: string
  /** The business sender (`whatsapp:+14155238886` is Twilio's sandbox number). */
  whatsappFrom?: string
  smsFrom?: string
}

/** `X-Twilio-Signature` for a form webhook: base64(HMAC-SHA1(authToken, url + sorted name+value)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  let data = url
  for (const name of Object.keys(params).sort()) data += name + params[name]
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

function twilioError(status: number, code: number, message: string, headers: Record<string, string> = {}): SimResponse {
  return { status, headers, body: { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status } }
}

const sid = (prefix: string): string => `${prefix}${ids.hex(16)}`

export class TwilioSimulator extends PlatformSimulator {
  readonly channel = 'twilio' as const
  readonly title = 'Twilio (WhatsApp / SMS)'
  readonly accountSid: string
  readonly authToken: string
  readonly whatsappFrom: string
  readonly smsFrom: string
  /** Message SID → StatusCallback URL given at send time. */
  private readonly callbacks = new Map<string, string>()

  constructor(options: TwilioSimulatorOptions = {}) {
    super(options, { id: 'whatsapp:+573001112233', name: 'Sandbox User' })
    this.accountSid = options.accountSid ?? `AC${'0'.repeat(30)}01`
    this.authToken = options.authToken ?? 'sandbox-twilio-auth-token'
    this.whatsappFrom = options.whatsappFrom ?? 'whatsapp:+14155238886'
    this.smsFrom = options.smsFrom ?? '+15005550006'
  }

  /** Config for `new TwilioProvider(...)`; `webhookUrl` is where the bot listens. */
  providerConfig(webhookUrl: string): { accountSid: string; authToken: string; whatsappFrom: string; smsFrom: string; webhookUrl: string; apiBaseUrl: string; messagingBaseUrl: string; http: { allowHttp: true; allowPrivateHosts: true } } {
    return {
      accountSid: this.accountSid,
      authToken: this.authToken,
      whatsappFrom: this.whatsappFrom,
      smsFrom: this.smsFrom,
      webhookUrl,
      apiBaseUrl: this.url,
      messagingBaseUrl: this.url,
      http: { allowHttp: true, allowPrivateHosts: true },
    }
  }

  private readonly auth = (req: SimRequest): boolean => {
    const h = req.header('authorization')
    if (!h?.startsWith('Basic ')) return false
    const [user, pass] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':')
    return user === this.accountSid && pass === this.authToken
  }

  protected routes(): void {
    const base = '/2010-04-01/Accounts/:account'
    this.api('POST', `${base}/Messages.json`, (req) => this.onCreate(req), { send: true, auth: this.auth, check: (req) => this.checkCreate(req) })
    // Media sub-resource: authenticated, answers with a redirect to the CDN (like api.twilio.com).
    this.api('GET', `${base}/Messages/:message/Media/:media`, (req) => {
      const item = this.media.get(req.params['media']!)
      if (!item) return twilioError(404, 20404, 'The requested resource was not found')
      return { status: 307, headers: { location: `${this.url}/twilio/cdn/${item.id}` }, body: '' }
    }, { auth: this.auth })
    this.api('GET', '/twilio/cdn/:id', (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 403, body: 'AccessDenied: Request has expired' }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    this.api('POST', '/v3/Indicators/Typing.json', (req) => {
      const body = req.json() as { channel?: string; messageId?: string }
      this.recordOutbound({ id: '', chatId: '', kind: 'action', action: 'typing', targetId: String(body.messageId ?? ''), raw: body })
      return { status: 200, body: { success: true } }
    }, {
      auth: this.auth,
      check: (req) => {
        const body = req.json() as { channel?: string; messageId?: string } | undefined
        const issues: string[] = []
        if (body?.channel !== 'WHATSAPP') issues.push('$.channel: must be "WHATSAPP"')
        if (!body?.messageId || !/^(SM|MM)[0-9a-f]{32}$/.test(body.messageId)) issues.push('$.messageId: must be an inbound message SID')
        return issues
      },
    })
  }

  private checkCreate(req: SimRequest): string[] {
    const f = req.form()
    const issues: string[] = []
    if (req.params['account'] !== this.accountSid) issues.push(`path: unknown account ${req.params['account']}`)
    if (!(req.header('content-type') ?? '').includes('application/x-www-form-urlencoded')) issues.push('Content-Type: must be application/x-www-form-urlencoded')
    const to = f.get('To')
    if (!to) issues.push("To: required")
    if (!f.get('From') && !f.get('MessagingServiceSid')) issues.push('From: required unless MessagingServiceSid is set')
    if (!f.get('Body') && f.getAll('MediaUrl').length === 0 && !f.get('ContentSid')) issues.push('Body: one of Body, MediaUrl or ContentSid is required')
    const body = f.get('Body')
    if (body !== null && [...body].length > 1600) issues.push(`Body: longer than 1600 (${[...body].length})`)
    const media = f.getAll('MediaUrl')
    if (media.length > 10) issues.push('MediaUrl: at most 10')
    for (const m of media) if (!/^https?:\/\//.test(m)) issues.push(`MediaUrl: not a URL: ${m}`)
    const from = f.get('From')
    if (to && from && to.startsWith('whatsapp:') !== from.startsWith('whatsapp:')) issues.push('From/To: both must use the whatsapp: prefix (or neither)')
    const vars = f.get('ContentVariables')
    if (vars !== null) {
      try { JSON.parse(vars) } catch { issues.push('ContentVariables: must be a JSON object string') }
    }
    for (const a of f.getAll('PersistentAction')) if (!/^(geo:|mailto:|tel:|sms:)/.test(a)) issues.push(`PersistentAction: unsupported action ${a}`)
    const cb = f.get('StatusCallback')
    if (cb !== null && !/^https?:\/\//.test(cb)) issues.push('StatusCallback: must be a URL')
    for (const i of validate(TWILIO_CREATE_MESSAGE_OPENAPI, formToObject(f, TWILIO_CREATE_MESSAGE_OPENAPI))) issues.push(`[openapi] ${i}`)
    return issues
  }

  private onCreate(req: SimRequest): SimResponse {
    const f = req.form()
    const to = f.get('To')!
    const msid = sid(f.getAll('MediaUrl').length ? 'MM' : 'SM')
    const body = f.get('Body') ?? ''
    const media = f.getAll('MediaUrl')
    const cb = f.get('StatusCallback')
    if (cb) this.callbacks.set(msid, cb)
    const action = f.getAll('PersistentAction').find((a) => a.startsWith('geo:'))
    const geo = action ? /^geo:(-?[\d.]+),(-?[\d.]+)(?:\|(.*))?$/.exec(action) : null
    const contentSid = f.get('ContentSid')
    if (contentSid) {
      this.recordOutbound({ id: msid, chatId: to, kind: 'template', template: { name: contentSid, params: f.get('ContentVariables') ?? undefined }, raw: Object.fromEntries(f) })
    } else if (geo) {
      this.recordOutbound({ id: msid, chatId: to, kind: 'location', text: body, location: { latitude: Number(geo[1]), longitude: Number(geo[2]), ...(geo[3] ? { name: geo[3] } : {}) }, raw: Object.fromEntries(f) })
    } else if (media.length) {
      this.recordOutbound({ id: msid, chatId: to, kind: guessKind(media[0]!), ...(body ? { text: body, caption: body } : {}), media: { url: media[0]! }, raw: Object.fromEntries(f) })
    } else {
      this.recordOutbound({ id: msid, chatId: to, kind: 'text', text: body, raw: Object.fromEntries(f) })
    }
    const now = new Date().toUTCString()
    return {
      status: 201,
      body: {
        account_sid: this.accountSid,
        api_version: '2010-04-01',
        body,
        date_created: now,
        date_sent: null,
        date_updated: now,
        direction: 'outbound-api',
        error_code: null,
        error_message: null,
        from: f.get('From') ?? null,
        messaging_service_sid: f.get('MessagingServiceSid'),
        num_media: String(media.length),
        num_segments: '1',
        price: null,
        price_unit: 'USD',
        sid: msid,
        status: f.get('MessagingServiceSid') ? 'accepted' : 'queued',
        subresource_uris: { media: `/2010-04-01/Accounts/${this.accountSid}/Messages/${msid}/Media.json` },
        to,
        uri: `/2010-04-01/Accounts/${this.accountSid}/Messages/${msid}.json`,
      },
    }
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    switch (kind) {
      case 'rateLimit': return twilioError(429, 20429, 'Too Many Requests', { 'retry-after': String(retryAfterSec) })
      case 'invalidRecipient': return twilioError(400, 21211, "Invalid 'To' Phone Number")
      case 'outsideWindow': return twilioError(400, 63016, 'Failed to send freeform message because you are outside the allowed window. If you are using WhatsApp, please use a Message Template.')
      case 'mediaTooLarge': return twilioError(400, 11751, 'Media exceeds messaging provider size limit')
      case 'auth': return twilioError(401, 20003, 'Authenticate', { 'www-authenticate': 'Basic realm="Twilio API"' })
      case 'serverError': return twilioError(500, 20500, 'Internal Server Error')
    }
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return twilioError(400, 21604, `Invalid parameter: ${issues.slice(0, 3).join('; ')}`)
  }

  protected notFound(): SimResponse {
    return twilioError(404, 20404, 'The requested resource was not found')
  }

  /* --- inbound ---------------------------------------------------------- */

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const isWa = user.id.startsWith('whatsapp:')
    const to = isWa ? this.whatsappFrom : this.smsFrom
    const media = input.media
    const msid = input.id ?? sid(media ? 'MM' : 'SM')
    const p: Record<string, string> = {
      SmsMessageSid: msid,
      SmsSid: msid,
      MessageSid: msid,
      AccountSid: this.accountSid,
      From: user.id,
      To: to,
      NumMedia: '0',
      NumSegments: '1',
      SmsStatus: 'received',
      ApiVersion: '2010-04-01',
      Body: '',
      ReferralNumMedia: '0',
    }
    if (isWa) {
      p['WaId'] = user.id.replace(/^whatsapp:\+?/, '')
      if (user.name) p['ProfileName'] = user.name
      p['MessageType'] = 'text'
    }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.quotedId) {
      p['OriginalRepliedMessageSid'] = input.quotedId
      p['OriginalRepliedMessageSender'] = to
    }
    if (input.text !== undefined) {
      p['Body'] = input.text
      text = input.text
    } else if (media) {
      const mimetype = media.mimetype ?? KIND_MIME[media.kind] ?? 'application/octet-stream'
      const item = this.media.put(media.data, { mimetype, id: sid('ME'), ...(media.filename ? { filename: media.filename } : {}) })
      p['NumMedia'] = '1'
      p['MediaContentType0'] = mimetype
      p['MediaUrl0'] = `${this.url}/2010-04-01/Accounts/${this.accountSid}/Messages/${msid}/Media/${item.id}`
      p['Body'] = media.caption ?? ''
      if (isWa) p['MessageType'] = media.kind === 'document' ? 'document' : media.kind === 'voice' ? 'audio' : media.kind
      kind = media.kind
      text = media.caption
    } else if (input.location) {
      const l = input.location
      p['Latitude'] = String(l.latitude)
      p['Longitude'] = String(l.longitude)
      if (l.address) p['Address'] = l.address
      if (l.name) p['Label'] = l.name
      if (isWa) p['MessageType'] = 'location'
      kind = 'location'
    } else if (input.reply) {
      const r = input.reply
      p['Body'] = r.title ?? r.id
      if (r.kind === 'button') {
        p['ButtonText'] = r.title ?? r.id
        p['ButtonPayload'] = r.id
        p['MessageType'] = 'button'
      } else {
        p['ListId'] = r.id
        p['ListTitle'] = r.title ?? r.id
        p['MessageType'] = 'interactive'
      }
      if (r.messageId) p['OriginalRepliedMessageSid'] = r.messageId
      kind = r.kind
      text = r.title ?? r.id
    } else {
      throw new Error('Twilio simulator: send text, media, location or a button/list reply')
    }
    return { id: msid, chatId: user.id, record: { id: msid, channel: this.channel, chatId: user.id, user, kind, ...(text !== undefined ? { text } : {}), at }, payload: p }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    return { id: prepared.id, chatId: prepared.chatId, deliveries: await this.post(prepared.payload as Record<string, string>) }
  }

  async status(messageId: string, status: MessageStatus, errorCode?: number): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    const to = out?.chatId ?? this.defaultUser.id
    const p: Record<string, string> = {
      MessageSid: messageId,
      SmsSid: messageId,
      AccountSid: this.accountSid,
      From: to.startsWith('whatsapp:') ? this.whatsappFrom : this.smsFrom,
      To: to,
      MessageStatus: status === 'sent' ? 'sent' : status,
      SmsStatus: status,
      ApiVersion: '2010-04-01',
      ...(to.startsWith('whatsapp:') ? { ChannelPrefix: 'whatsapp', ChannelToAddress: to.replace(/^whatsapp:/, '') } : {}),
      ...(status === 'failed' ? { ErrorCode: String(errorCode ?? 63016), ErrorMessage: 'Message failed' } : {}),
    }
    this.recordInbound({ id: messageId, channel: this.channel, chatId: to, user: { id: to }, kind: 'status', text: status, at: Date.now() })
    const url = this.callbacks.get(messageId) ?? this.webhookUrl
    return { id: messageId, chatId: to, deliveries: await this.post(p, { url: url ?? '' }) }
  }

  /** POST form params to the bot, signed (`signature: false` omits the header). */
  async post(params: Record<string, string>, opts: { signature?: string | false; url?: string } = {}): Promise<SendOutcome['deliveries']> {
    const url = opts.url || this.webhookUrl
    if (!url) throw new Error('setWebhook(url) first')
    const body = new URLSearchParams(params).toString()
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'user-agent': 'TwilioProxy/1.1', 'i-twilio-idempotency-token': ids.hex(16) }
    if (opts.signature !== false) headers['x-twilio-signature'] = opts.signature ?? twilioSignature(this.authToken, url, params)
    return this.postWebhook(body, headers, url)
  }
}

function guessKind(url: string): 'image' | 'video' | 'audio' | 'document' {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (['mp4', '3gp', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'ogg', 'amr', 'aac', 'm4a', 'opus'].includes(ext)) return 'audio'
  return 'document'
}
