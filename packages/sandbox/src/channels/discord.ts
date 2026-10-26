/**
 * Discord simulator: REST API v10 (messages, edits, deletes, reactions,
 * typing, interaction callbacks, followups) plus a Gateway v10 WebSocket on
 * the same port (`ws://<host>/gateway`) that speaks HELLO / IDENTIFY / READY /
 * HEARTBEAT / RESUME and dispatches `MESSAGE_CREATE` and `INTERACTION_CREATE`.
 *
 * Request bodies are checked against the `MessageCreateRequest` rules of
 * discord-api-spec (content ≤ 2000, ≤ 10 embeds, ≤ 5 action rows of ≤ 5
 * components, button label ≤ 80 and custom_id ≤ 100, select ≤ 25 options,
 * poll ≤ 10 answers of ≤ 55 chars).
 */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
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
import { validate, type Schema } from '../sim/validate.js'

export interface DiscordSimulatorOptions extends BaseSimulatorOptions {
  token?: string
  botUserId?: string
  applicationId?: string
  /** Deliver user messages in this guild channel instead of a DM. */
  guildId?: string
  heartbeatIntervalMs?: number
}

const component: Schema = {
  type: 'object', required: ['type'],
  properties: {
    type: { enum: [2, 3, 4, 5, 6, 7, 8] },
    style: { type: 'integer', minimum: 1, maximum: 6 },
    label: { type: 'string', maxLength: 80 },
    custom_id: { type: 'string', minLength: 1, maxLength: 100 },
    url: { type: 'string' },
    disabled: { type: 'boolean' },
    placeholder: { type: 'string', maxLength: 150 },
    min_values: { type: 'integer', minimum: 0, maximum: 25 },
    max_values: { type: 'integer', minimum: 1, maximum: 25 },
    options: {
      type: 'array', minItems: 1, maxItems: 25,
      items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string', minLength: 1, maxLength: 100 }, value: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 100 } } },
    },
  },
}

/** `POST /channels/{id}/messages` (MessageCreateRequest subset). */
export const DISCORD_MESSAGE_SCHEMA: Schema = {
  type: 'object',
  properties: {
    content: { type: 'string', maxLength: 2000 },
    tts: { type: 'boolean' },
    embeds: { type: 'array', maxItems: 10, items: { type: 'object', properties: { title: { type: 'string', maxLength: 256 }, description: { type: 'string', maxLength: 4096 }, url: { type: 'string' } } } },
    allowed_mentions: { type: 'object' },
    message_reference: { type: 'object', required: ['message_id'], properties: { message_id: { type: 'string' }, channel_id: { type: 'string' }, fail_if_not_exists: { type: 'boolean' } } },
    components: { type: 'array', maxItems: 5, items: { type: 'object', required: ['type', 'components'], properties: { type: { const: 1 }, components: { type: 'array', minItems: 1, maxItems: 5, items: component } } } },
    sticker_ids: { type: 'array', maxItems: 3 },
    attachments: { type: 'array', maxItems: 10 },
    flags: { type: 'integer' },
    poll: {
      type: 'object', required: ['question', 'answers'],
      properties: {
        question: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 300 } } },
        answers: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['poll_media'], properties: { poll_media: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 55 } } } } } },
        duration: { type: 'integer', minimum: 1, maximum: 768 },
        allow_multiselect: { type: 'boolean' },
      },
    },
  },
}

function messageRules(b: Record<string, unknown>, files: number): string[] {
  const issues: string[] = []
  const empty = (b['content'] === undefined || b['content'] === '') && !b['embeds'] && !b['components'] && !b['poll'] && !b['sticker_ids'] && files === 0
  if (empty) issues.push('$: Cannot send an empty message (code 50006)')
  for (const row of (b['components'] as Array<{ components?: Array<Record<string, unknown>> }> | undefined) ?? []) {
    for (const c of row.components ?? []) {
      if (c['type'] === 2 && c['style'] !== 5 && !c['custom_id']) issues.push('$.components: a non-link button needs custom_id')
      if (c['type'] === 2 && c['style'] === 5 && !c['url']) issues.push('$.components: a link button needs url')
      if (c['type'] === 3 && (row.components?.length ?? 0) > 1) issues.push('$.components: a select menu must be alone in its action row')
    }
  }
  return issues
}

export class DiscordSimulator extends PlatformSimulator {
  readonly channel = 'discord' as const
  readonly title = 'Discord'
  readonly token: string
  readonly botUserId: string
  readonly applicationId: string
  readonly guildId: string | undefined
  private readonly heartbeatIntervalMs: number
  private wss: WebSocketServer | undefined
  private readonly sockets = new Set<WebSocket>()
  private readonly identified = new Set<WebSocket>()
  private seq = 0
  private sessionId = ''
  /** user id → DM channel id */
  private readonly dmChannels = new Map<string, string>()
  /** Identify payloads received (intents, properties) for assertions. */
  readonly identifies: Array<Record<string, unknown>> = []

  constructor(options: DiscordSimulatorOptions = {}) {
    super(options, { id: '80351110224678912', name: 'sandbox_user' })
    this.token = options.token ?? 'sandbox.discord.bot-token'
    this.botUserId = options.botUserId ?? '1100000000000000001'
    this.applicationId = options.applicationId ?? '1100000000000000002'
    this.guildId = options.guildId
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 41_250
  }

  providerConfig(): { token: string; appId: string; apiUrl: string; gatewayUrl: string; mediaDownload: { allowHttp: true; allowPrivateHosts: true }; mediaRefHosts: string[] } {
    const host = new URL(this.url).hostname
    return {
      token: this.token,
      appId: this.applicationId,
      apiUrl: `${this.url}/api`,
      gatewayUrl: `${this.url.replace(/^http/, 'ws')}/gateway`,
      mediaDownload: { allowHttp: true, allowPrivateHosts: true },
      mediaRefHosts: [host],
    }
  }

  /** Whether a bot is connected and identified on the gateway. */
  get connected(): boolean {
    return this.identified.size > 0
  }

  /** Resolve once a bot has identified on the gateway. */
  async waitForGateway(timeoutMs = 5_000): Promise<void> {
    const end = Date.now() + timeoutMs
    while (!this.connected) {
      if (Date.now() > end) throw new Error('discord simulator: no bot identified on the gateway')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  channelOf(userId: string): string {
    if (this.guildId) return `${this.guildId.slice(0, -1)}9`
    let id = this.dmChannels.get(userId)
    if (!id) {
      id = ids.snowflake()
      this.dmChannels.set(userId, id)
    }
    return id
  }

  private readonly auth = (req: SimRequest): boolean => req.header('authorization') === `Bot ${this.token}`

  protected async afterStart(): Promise<void> {
    const wss = new WebSocketServer({ noServer: true })
    this.wss = wss
    this.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '')
      if (path !== '/gateway') {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws))
    })
  }

  protected async beforeStop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate()
    this.sockets.clear()
    this.identified.clear()
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()))
    this.wss = undefined
  }

  /** Close the bot's gateway socket with a close code (e.g. 4000 to test resume, 4004 for a bad token). */
  dropGateway(code = 4000): void {
    for (const ws of this.sockets) ws.close(code)
  }

  private onSocket(ws: WebSocket): void {
    this.sockets.add(ws)
    ws.on('close', () => {
      this.sockets.delete(ws)
      this.identified.delete(ws)
    })
    ws.on('message', (data) => this.onFrame(ws, data.toString()))
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: this.heartbeatIntervalMs, _trace: ['["sandbox-gateway",{"micros":0}]'] }, s: null, t: null }))
  }

  private onFrame(ws: WebSocket, text: string): void {
    let frame: { op?: number; d?: Record<string, unknown> | number | null }
    try { frame = JSON.parse(text) as typeof frame } catch { ws.close(4002, 'Decode error'); return }
    switch (frame.op) {
      case 1:
        ws.send(JSON.stringify({ op: 11 }))
        return
      case 2: {
        const d = (frame.d ?? {}) as Record<string, unknown>
        this.identifies.push({ intents: d['intents'], properties: d['properties'] })
        if (d['token'] !== this.token) { ws.close(4004, 'Authentication failed.'); return }
        if (typeof d['intents'] !== 'number') { ws.close(4013, 'Invalid intent(s).'); return }
        this.sessionId = randomBytes(16).toString('hex')
        this.identified.add(ws)
        this.dispatchTo(ws, 'READY', {
          v: 10,
          user: { id: this.botUserId, username: 'sandbox-bot', discriminator: '0', bot: true, avatar: null, global_name: null },
          guilds: this.guildId ? [{ id: this.guildId, unavailable: true }] : [],
          session_id: this.sessionId,
          resume_gateway_url: `${this.url.replace(/^http/, 'ws')}/gateway`,
          application: { id: this.applicationId, flags: 0 },
        })
        return
      }
      case 6: {
        const d = (frame.d ?? {}) as Record<string, unknown>
        if (d['token'] !== this.token || d['session_id'] !== this.sessionId) { ws.send(JSON.stringify({ op: 9, d: false })); return }
        this.identified.add(ws)
        this.dispatchTo(ws, 'RESUMED', null)
        return
      }
      default:
        return
    }
  }

  private dispatchTo(ws: WebSocket, t: string, d: unknown): void {
    this.seq += 1
    ws.send(JSON.stringify({ op: 0, s: this.seq, t, d }))
  }

  private dispatch(t: string, d: unknown): SendOutcome['deliveries'] {
    const out: SendOutcome['deliveries'] = []
    for (const ws of this.identified) {
      this.dispatchTo(ws, t, d)
      const rec = { url: 'gateway', status: 200, ok: true, attempt: 1, at: Date.now() }
      out.push(rec)
      this.deliveries.push(rec)
      this.emit('delivery', rec)
    }
    if (out.length === 0) {
      const rec = { url: 'gateway', status: 0, ok: false, attempt: 1, at: Date.now(), error: 'no bot connected to the gateway' }
      out.push(rec)
      this.deliveries.push(rec)
    }
    return out
  }

  /* --- REST -------------------------------------------------------------- */

  private async readMessageBody(req: SimRequest): Promise<{ body: Record<string, unknown>; files: Array<{ name: string; type: string; data: Buffer }> }> {
    const ct = req.header('content-type') ?? ''
    if (ct.startsWith('multipart/form-data')) {
      const form = await req.multipart()
      const files: Array<{ name: string; type: string; data: Buffer }> = []
      for (const [key, value] of form) {
        if (/^files\[\d+\]$/.test(key) && value instanceof Blob) files.push({ name: (value as File).name ?? 'file', type: value.type, data: Buffer.from(await value.arrayBuffer()) })
      }
      const json = form.get('payload_json')
      return { body: typeof json === 'string' ? (JSON.parse(json) as Record<string, unknown>) : {}, files }
    }
    return { body: (req.json() as Record<string, unknown>) ?? {}, files: [] }
  }

  private messageObject(channelId: string, id: string, body: Record<string, unknown>, attachments: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
      id, channel_id: channelId, type: 0, content: body['content'] ?? '', tts: false, mention_everyone: false, mentions: [], mention_roles: [],
      attachments, embeds: body['embeds'] ?? [], components: body['components'] ?? [], pinned: false, flags: 0,
      timestamp: new Date().toISOString(), edited_timestamp: null,
      author: { id: this.botUserId, username: 'sandbox-bot', discriminator: '0', bot: true, avatar: null, global_name: null },
      ...(body['poll'] ? { poll: body['poll'] } : {}),
    }
  }

  private async onCreate(req: SimRequest, channelId: string): Promise<SimResponse> {
    const { body, files } = await this.readMessageBody(req)
    const id = ids.snowflake()
    const attachments = files.map((f) => {
      const item = this.media.put(f.data, { mimetype: f.type || 'application/octet-stream', filename: f.name, origin: 'bot', id: ids.snowflake() })
      return { id: item.id, filename: f.name, size: f.data.length, url: `${this.url}/discord/cdn/attachments/${channelId}/${item.id}/${encodeURIComponent(f.name)}`, content_type: item.mimetype }
    })
    this.recordOutbound({ id, chatId: channelId, ...describe(body, attachments), raw: body })
    return { status: 200, body: this.messageObject(channelId, id, body, attachments) }
  }

  protected routes(): void {
    const v = '/api/:ver'
    const checkCreate = async (req: SimRequest): Promise<string[]> => {
      const { body, files } = await this.readMessageBody(req).catch(() => ({ body: undefined as unknown as Record<string, unknown>, files: [] }))
      if (!body) return ['body: unreadable']
      return [...validate(DISCORD_MESSAGE_SCHEMA, body), ...messageRules(body, files.length)]
    }
    this.api('GET', '/discord/cdn/attachments/:channel/:id/:name', (req) => {
      const item = this.media.get(req.params['id']!)
      if (!item) return { status: 404, body: 'This content is no longer available.' }
      return { status: 200, headers: { 'content-type': item.mimetype }, body: item.data }
    })
    this.api('POST', `${v}/channels/:channel/messages`, (req) => this.onCreate(req, req.params['channel']!), { send: true, auth: this.auth, check: checkCreate })
    this.api('POST', `${v}/webhooks/:app/:token`, (req) => this.onCreate(req, 'followup'), { send: true, check: checkCreate })
    this.api('PATCH', `${v}/channels/:channel/messages/:message`, async (req) => {
      const { body } = await this.readMessageBody(req)
      this.recordOutbound({ id: '', chatId: req.params['channel']!, kind: 'edit', targetId: req.params['message']!, ...(typeof body['content'] === 'string' ? { text: body['content'] } : {}), raw: body })
      return { status: 200, body: this.messageObject(req.params['channel']!, req.params['message']!, body, []) }
    }, { send: true, auth: this.auth })
    this.api('DELETE', `${v}/channels/:channel/messages/:message`, (req) => {
      this.recordOutbound({ id: '', chatId: req.params['channel']!, kind: 'delete', targetId: req.params['message']!, raw: {} })
      return { status: 204 }
    }, { auth: this.auth })
    this.api('PUT', `${v}/channels/:channel/messages/:message/reactions/:emoji/@me`, (req) => {
      this.recordOutbound({ id: '', chatId: req.params['channel']!, kind: 'reaction', text: req.params['emoji']!, targetId: req.params['message']!, raw: {} })
      return { status: 204 }
    }, { auth: this.auth })
    this.api('DELETE', `${v}/channels/:channel/messages/:message/reactions/:emoji/@me`, (req) => {
      this.recordOutbound({ id: '', chatId: req.params['channel']!, kind: 'reaction', text: '', targetId: req.params['message']!, raw: {} })
      return { status: 204 }
    }, { auth: this.auth })
    this.api('POST', `${v}/channels/:channel/typing`, (req) => {
      this.recordOutbound({ id: '', chatId: req.params['channel']!, kind: 'action', action: 'typing', raw: {} })
      return { status: 204 }
    }, { auth: this.auth })
    this.api('POST', `${v}/interactions/:id/:token/callback`, (req) => {
      const body = req.json() as { type?: number; data?: { content?: string } }
      this.recordOutbound({ id: '', chatId: '', kind: 'action', action: `interaction_callback:${body.type}`, targetId: req.params['id']!, ...(body.data?.content ? { text: body.data.content } : {}), raw: body })
      return { status: 204 }
    }, {
      check: (req) => {
        const body = req.json() as { type?: number } | undefined
        return [1, 4, 5, 6, 7, 8, 9, 10, 12].includes(Number(body?.type)) ? [] : ['$.type: not a valid interaction callback type']
      },
    })
  }

  protected faultResponse(kind: FaultKind, _req: SimRequest, retryAfterSec: number): SimResponse {
    const err = (status: number, code: number, message: string, headers: Record<string, string> = {}): SimResponse => ({ status, headers, body: { message, code } })
    switch (kind) {
      case 'rateLimit':
        return {
          status: 429,
          headers: { 'retry-after': String(Math.ceil(retryAfterSec)), 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': String(retryAfterSec), 'x-ratelimit-bucket': ids.hex(16), 'x-ratelimit-scope': 'user' },
          body: { message: 'You are being rate limited.', retry_after: retryAfterSec, global: false },
        }
      case 'invalidRecipient': return err(403, 50007, 'Cannot send messages to this user')
      case 'outsideWindow': return err(403, 50001, 'Missing Access')
      case 'mediaTooLarge': return err(413, 40005, 'Request entity too large')
      case 'auth': return err(401, 0, '401: Unauthorized')
      case 'serverError': return err(500, 0, '500: Internal Server Error')
    }
  }

  protected invalidResponse(issues: string[]): SimResponse {
    return { status: 400, body: { message: 'Invalid Form Body', code: 50035, errors: { _errors: issues.map((m) => ({ code: 'BASE_TYPE_INVALID', message: m })) } } }
  }

  protected notFound(): SimResponse {
    return { status: 404, body: { message: '404: Not Found', code: 0 } }
  }

  /* --- inbound ---------------------------------------------------------- */

  private author(user: { id: string; name?: string }): Record<string, unknown> {
    return { id: user.id, username: user.name ?? 'user', discriminator: '0', global_name: user.name ?? null, avatar: null }
  }

  async prepare(input: UserInput): Promise<PreparedInbound> {
    const user = this.user(input)
    const at = input.at ?? Date.now()
    const channelId = this.channelOf(user.id)
    const id = input.id ?? ids.snowflake(at)
    const guild = this.guildId ? { guild_id: this.guildId, member: { nick: null, roles: [] } } : {}
    if (input.reply) {
      const r = input.reply
      const message = r.messageId ? { id: r.messageId } : { id: this.outbox.filter((o) => o.kind === 'buttons' || o.kind === 'list').at(-1)?.id ?? ids.snowflake() }
      const d = {
        id, application_id: this.applicationId, type: 3, token: `aW50ZXJhY3Rpb24${randomBytes(24).toString('base64url')}`, version: 1,
        channel_id: channelId, channel: { id: channelId, type: this.guildId ? 0 : 1 },
        ...(this.guildId ? { guild_id: this.guildId, member: { user: this.author(user), roles: [] } } : { user: this.author(user) }),
        data: r.kind === 'list' ? { component_type: 3, custom_id: 'botmesh:list', values: [r.id] } : { component_type: 2, custom_id: r.id },
        message, locale: 'es-ES', app_permissions: '0',
      }
      return { id, chatId: channelId, record: { id, channel: this.channel, chatId: channelId, user, kind: r.kind, text: r.title ?? r.id, at }, payload: { t: 'INTERACTION_CREATE', d } }
    }
    const d: Record<string, unknown> = {
      id, channel_id: channelId, type: input.quotedId ? 19 : 0, author: this.author(user), content: '', timestamp: new Date(at).toISOString(),
      edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, flags: 0, components: [],
      nonce: ids.digits(18), ...guild,
      ...(input.quotedId ? { message_reference: { type: 0, message_id: input.quotedId, channel_id: channelId } } : {}),
    }
    let kind: PreparedInbound['record']['kind'] = 'text'
    let text: string | undefined
    if (input.text !== undefined) {
      d['content'] = input.text
      text = input.text
    } else if (input.media) {
      const m = input.media
      const mimetype = m.mimetype ?? KIND_MIME[m.kind] ?? 'application/octet-stream'
      const name = m.filename ?? `file.${mimetype.split('/')[1] ?? 'bin'}`
      const item = this.media.put(m.data, { mimetype, filename: name, id: ids.snowflake() })
      d['content'] = m.caption ?? ''
      d['attachments'] = [{ id: item.id, filename: name, size: m.data.length, url: `${this.url}/discord/cdn/attachments/${channelId}/${item.id}/${encodeURIComponent(name)}?ex=${Math.floor(((item.expiresAt ?? at + 86_400_000)) / 1000).toString(16)}`, proxy_url: '', content_type: mimetype }]
      kind = m.kind
      text = m.caption
    } else {
      throw new Error('Discord simulator: send text, an attachment or a component interaction (no location messages on Discord)')
    }
    return { id, chatId: channelId, record: { id, channel: this.channel, chatId: channelId, user, kind, ...(text !== undefined ? { text } : {}), at }, payload: { t: 'MESSAGE_CREATE', d } }
  }

  async deliver(prepared: PreparedInbound): Promise<SendOutcome> {
    this.recordInbound(prepared.record)
    const { t, d } = prepared.payload as { t: string; d: unknown }
    return { id: prepared.id, chatId: prepared.chatId, deliveries: this.dispatch(t, d) }
  }

  /** Discord has no delivery receipts; a `read` becomes a no-op record. */
  async status(messageId: string, status: MessageStatus): Promise<SendOutcome> {
    const out = this.outbox.find((o) => o.id === messageId)
    this.recordInbound({ id: messageId, channel: this.channel, chatId: out?.chatId ?? '', user: { id: this.botUserId }, kind: 'status', text: status, at: Date.now() })
    return { id: messageId, chatId: out?.chatId ?? '', deliveries: [] }
  }
}

function describe(body: Record<string, unknown>, attachments: Array<Record<string, unknown>>): Omit<OutboundRecord, 'id' | 'chatId' | 'channel' | 'raw' | 'at'> {
  const content = typeof body['content'] === 'string' && body['content'] !== '' ? body['content'] : undefined
  const poll = body['poll'] as { question?: { text?: string }; answers?: Array<{ poll_media?: { text?: string } }> } | undefined
  if (poll) return { kind: 'poll', poll: { question: poll.question?.text ?? '', options: (poll.answers ?? []).map((a) => a.poll_media?.text ?? '') } }
  const rows = (body['components'] as Array<{ components?: Array<Record<string, unknown>> }> | undefined) ?? []
  const comps = rows.flatMap((r) => r.components ?? [])
  const select = comps.find((c) => c['type'] === 3)
  if (select) {
    const options = (select['options'] as Array<{ label: string; value: string; description?: string }> | undefined) ?? []
    return { kind: 'list', ...(content ? { text: content } : {}), sections: [{ rows: options.map((o) => ({ id: o.value, title: o.label, ...(o.description ? { description: o.description } : {}) })) }] }
  }
  const buttons = comps.filter((c) => c['type'] === 2)
  if (buttons.length) return { kind: 'buttons', ...(content ? { text: content } : {}), buttons: buttons.map((b) => ({ id: String(b['custom_id'] ?? ''), title: String(b['label'] ?? ''), ...(b['url'] ? { url: String(b['url']) } : {}) })) }
  const att = attachments[0]
  if (att) {
    const type = String(att['content_type'] ?? '')
    const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'document'
    return { kind, ...(content ? { text: content, caption: content } : {}), media: { url: String(att['url']), mimetype: type, filename: String(att['filename']) } }
  }
  const embeds = body['embeds'] as Array<{ title?: string; description?: string; url?: string }> | undefined
  if (!content && embeds?.length) return { kind: 'card', text: [embeds[0]!.title, embeds[0]!.description, embeds[0]!.url].filter(Boolean).join('\n') }
  return { kind: 'text', text: content ?? '' }
}
