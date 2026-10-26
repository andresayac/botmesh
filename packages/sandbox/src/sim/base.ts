/**
 * PlatformSimulator: the base every channel simulator extends. It owns the
 * HTTP server, the record of API requests (with spec issues), the outbox of
 * what the bot sent, the inbox of what the simulated users sent, fault
 * injection and webhook delivery with platform-style retries.
 */

import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listen, readBody, Router, toSimRequest, writeResponse, type Listening, type SimHandler, type SimRequest, type SimResponse } from './http.js'
import { MediaStore, type StoredMedia } from './media.js'
import { validate, type Schema } from './validate.js'

export type ChannelName =
  | 'whatsapp'
  | 'messenger'
  | 'instagram'
  | 'twilio'
  | 'gupshup'
  | 'gohighlevel'
  | 'tiktok'
  | 'discord'
  | 'telegram'

/** Errors a simulator can be told to answer with (each in the platform's own format). */
export type FaultKind =
  | 'rateLimit'
  | 'invalidRecipient'
  | 'outsideWindow'
  | 'mediaTooLarge'
  | 'auth'
  | 'serverError'

export interface FaultOptions {
  /** How many matching requests fail. Default 1. `Infinity` until `clearFaults()`. */
  times?: number
  /** Only requests this predicate accepts fail. Default: every send-type request. */
  match?: (req: SimRequest) => boolean
  /** Retry delay announced by a `rateLimit` fault, in seconds. Default 2. */
  retryAfterSec?: number
}

interface FaultRule extends Required<Pick<FaultOptions, 'times' | 'retryAfterSec'>> {
  kind: FaultKind
  match?: (req: SimRequest) => boolean
}

/** A simulated end user. */
export interface SimUser {
  id: string
  name?: string
}

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker'

/** What a simulated user does. Exactly one of text / media / location / reply / edit / pollVote. */
export interface UserInput {
  /** Default: the simulator's default user. */
  user?: Partial<SimUser>
  text?: string
  media?: { kind: MediaKind; data: Buffer; mimetype?: string; filename?: string; caption?: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  /** Tap a button or pick a list row the bot sent. */
  reply?: { kind: 'button' | 'list'; id: string; title?: string; messageId?: string }
  /** Edit an earlier user message (platforms that deliver edits). */
  edit?: { messageId: string; text: string }
  /** Vote in a poll the bot sent (platforms with native polls). */
  pollVote?: { pollId: string; optionIds: number[] }
  /** Reply-to (quote) an earlier message id. */
  quotedId?: string
  /** Fixed message id (default: a fresh platform-style id). Reusing one simulates a redelivery. */
  id?: string
  /** Event time (epoch ms). Default now. */
  at?: number
}

/** One inbound event recorded by the simulator (for the UI and assertions). */
export interface InboundRecord {
  id: string
  channel: ChannelName
  chatId: string
  user: SimUser
  kind: 'text' | MediaKind | 'location' | 'button' | 'list' | 'edit' | 'poll_vote' | 'status'
  text?: string
  at: number
}

/** A normalized view of one message the bot sent through the platform API. */
export interface OutboundRecord {
  id: string
  channel: ChannelName
  chatId: string
  kind:
    | 'text' | MediaKind | 'location' | 'contact' | 'buttons' | 'list' | 'template' | 'poll'
    | 'reaction' | 'card' | 'action' | 'edit' | 'delete' | 'unknown'
  text?: string
  caption?: string
  buttons?: Array<{ id: string; title: string; url?: string }>
  sections?: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>
  media?: { url?: string; mediaId?: string; mimetype?: string; filename?: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  template?: { name: string; language?: string; params?: unknown }
  poll?: { question: string; options: string[] }
  /** Sender actions (`typing_on`, `mark_seen`, `TYPING`, …). */
  action?: string
  /** Target message of an edit, delete or reaction. */
  targetId?: string
  raw: unknown
  at: number
}

/** Result of one webhook POST to the bot (or of one queued update / gateway frame). */
export interface DeliveryRecord {
  url: string
  status: number
  ok: boolean
  attempt: number
  at: number
  error?: string
}

/** A built inbound event, ready to deliver (possibly more than once, or out of order). */
export interface PreparedInbound {
  id: string
  chatId: string
  record: InboundRecord
  /** Platform payload (webhook body, Update, gateway dispatch...). */
  payload: unknown
}

export interface SendOutcome {
  id: string
  chatId: string
  deliveries: DeliveryRecord[]
}

/** One API request a provider made, with what was wrong with it. */
export interface RecordedRequest {
  method: string
  path: string
  at: number
  status: number
  issues: string[]
  fault?: FaultKind
}

export interface BaseSimulatorOptions {
  /** Port to listen on. Default: a free port. */
  port?: number
  /** Host to bind. Default `127.0.0.1`. */
  host?: string
  /** Where the bot receives this platform's webhooks. Can be set later with `setWebhook()`. */
  webhookUrl?: string
  /** Lifetime of inbound media URLs in ms (default: no expiry). */
  mediaTtlMs?: number
  /**
   * Requests that break the documented request shape are answered with the
   * platform's validation error (default `true`). With `false` they succeed
   * and are only recorded in `issues()`.
   */
  strict?: boolean
  /**
   * Platform-style webhook retries: when the bot answers non-2xx (or the
   * connection fails), deliver again up to this many times. Default 0.
   */
  webhookRetries?: number
  /** Delay between webhook retries in ms. Default 50. */
  webhookRetryDelayMs?: number
  /**
   * After each outbound message, deliver delivery/read statuses to the bot
   * (`'delivered'` or `'read'`). Default `false`.
   */
  autoStatus?: false | 'delivered' | 'read'
  /** Default user for `send()`. */
  user?: SimUser
}

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

/** Random id helpers in the platforms' formats. */
export const ids = {
  hex: (bytes: number): string => randomBytes(bytes).toString('hex'),
  upperHex: (bytes: number): string => randomBytes(bytes).toString('hex').toUpperCase(),
  digits: (n: number): string => Array.from(randomBytes(n), (b) => String(b % 10)).join('').replace(/^0/, '1'),
  /** Discord/Twitter-style snowflake for "now". */
  snowflake: (at = Date.now()): string => ((BigInt(at - 1_420_070_400_000) << 22n) | BigInt(randomBytes(2).readUInt16BE(0) & 0x3fffff)).toString(),
}

export abstract class PlatformSimulator extends EventEmitter {
  abstract readonly channel: ChannelName
  /** Platform display name (UI). */
  abstract readonly title: string

  readonly media: MediaStore
  readonly outbox: OutboundRecord[] = []
  readonly inbox: InboundRecord[] = []
  readonly requests: RecordedRequest[] = []
  readonly deliveries: DeliveryRecord[] = []

  protected readonly router = new Router()
  protected webhookUrl: string | undefined
  protected readonly strict: boolean
  protected readonly webhookRetries: number
  protected readonly webhookRetryDelayMs: number
  protected autoStatus: false | 'delivered' | 'read'
  protected defaultUser: SimUser
  private faults: FaultRule[] = []
  private listening: Listening | undefined
  private routesBuilt = false
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(protected readonly options: BaseSimulatorOptions, defaultUser: SimUser) {
    super()
    this.media = new MediaStore(options.mediaTtlMs)
    this.webhookUrl = options.webhookUrl
    this.strict = options.strict ?? true
    this.webhookRetries = options.webhookRetries ?? 0
    this.webhookRetryDelayMs = options.webhookRetryDelayMs ?? 50
    this.autoStatus = options.autoStatus ?? false
    this.defaultUser = options.user ?? defaultUser
  }

  /** Base URL of the simulator (`http://127.0.0.1:<port>`). Throws before `start()`. */
  get url(): string {
    if (!this.listening) throw new Error(`${this.channel} simulator is not started`)
    return this.listening.url
  }

  get started(): boolean {
    return this.listening !== undefined
  }

  /** The node:http server (for simulators that also upgrade to WebSocket). */
  protected get httpServer(): import('node:http').Server | undefined {
    return this.listening?.server
  }

  /** Register the platform routes on {@link router}. */
  protected abstract routes(): void
  /** Build the platform's inbound payload for a user action. */
  abstract prepare(input: UserInput): Promise<PreparedInbound>
  /** Deliver a prepared payload to the bot (webhook POST, queued update or gateway frame). */
  abstract deliver(prepared: PreparedInbound): Promise<SendOutcome>
  /** Deliver a status webhook (delivered / read / failed) for a message the bot sent. */
  abstract status(messageId: string, status: MessageStatus): Promise<SendOutcome>
  /** The platform's error answer for a fault. */
  protected abstract faultResponse(kind: FaultKind, req: SimRequest, retryAfterSec: number): SimResponse
  /** The platform's answer to an invalid request (strict mode). */
  protected abstract invalidResponse(issues: string[], req: SimRequest): SimResponse
  /** The platform's 404 for an unknown endpoint. */
  protected notFound(req: SimRequest): SimResponse {
    return { status: 404, body: { error: `Unknown endpoint ${req.method} ${req.path}` } }
  }

  async start(): Promise<this> {
    if (this.listening) return this
    if (!this.routesBuilt) {
      this.routes()
      this.routesBuilt = true
    }
    this.listening = await listen((req, res) => this.handle(req, res), {
      ...(this.options.port !== undefined ? { port: this.options.port } : {}),
      ...(this.options.host !== undefined ? { host: this.options.host } : {}),
    })
    await this.afterStart()
    return this
  }

  /** Hook for simulators with extra listeners (Discord gateway). */
  protected async afterStart(): Promise<void> {}
  protected async beforeStop(): Promise<void> {}

  async stop(): Promise<void> {
    for (const t of this.pendingTimers) clearTimeout(t)
    this.pendingTimers.clear()
    await this.beforeStop()
    const l = this.listening
    this.listening = undefined
    await l?.close()
  }

  /** Point webhook deliveries at the bot. */
  setWebhook(url: string): void {
    this.webhookUrl = url
  }

  get webhook(): string | undefined {
    return this.webhookUrl
  }

  setAutoStatus(mode: false | 'delivered' | 'read'): void {
    this.autoStatus = mode
  }

  /** Make the next matching request(s) fail with a platform error. */
  fail(kind: FaultKind, opts: FaultOptions = {}): this {
    this.faults.push({ kind, times: opts.times ?? 1, retryAfterSec: opts.retryAfterSec ?? 2, ...(opts.match ? { match: opts.match } : {}) })
    return this
  }

  clearFaults(): void {
    this.faults = []
  }

  /** Forget recorded traffic (outbox, inbox, requests, deliveries) and faults. */
  reset(): void {
    this.outbox.length = 0
    this.inbox.length = 0
    this.requests.length = 0
    this.deliveries.length = 0
    this.faults = []
  }

  /** Requests that broke the documented request shape. */
  issues(): Array<{ method: string; path: string; issues: string[] }> {
    return this.requests.filter((r) => r.issues.length > 0).map(({ method, path, issues }) => ({ method, path, issues }))
  }

  /** Act as a user: build the platform payload and deliver it to the bot. */
  async send(input: UserInput): Promise<SendOutcome> {
    return this.deliver(await this.prepare(input))
  }

  /** Shorthand for a text message. */
  async sendText(text: string, user?: Partial<SimUser>): Promise<SendOutcome> {
    return this.send({ text, ...(user ? { user } : {}) })
  }

  /**
   * Resolve with the first outbound record (already recorded or future) that
   * `pred` accepts. Rejects after `timeoutMs` (default 5000).
   */
  waitForOutbound(pred: (r: OutboundRecord) => boolean = () => true, timeoutMs = 5_000): Promise<OutboundRecord> {
    const existing = this.outbox.find(pred)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const onOut = (r: OutboundRecord) => {
        if (!pred(r)) return
        clearTimeout(timer)
        this.off('outbound', onOut)
        resolve(r)
      }
      const timer = setTimeout(() => {
        this.off('outbound', onOut)
        reject(new Error(`${this.channel} simulator: no matching outbound message within ${timeoutMs}ms (outbox: ${JSON.stringify(this.outbox.map((o) => ({ kind: o.kind, text: o.text })))})`))
      }, timeoutMs)
      this.on('outbound', onOut)
    })
  }

  /** Resolve once `count` outbound records exist (counting from now when `fresh`). */
  async waitForOutboundCount(count: number, timeoutMs = 5_000): Promise<OutboundRecord[]> {
    const deadline = Date.now() + timeoutMs
    while (this.outbox.length < count) {
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`${this.channel} simulator: expected ${count} outbound messages, got ${this.outbox.length}`)
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { this.off('outbound', done); resolve() }, Math.min(left, 100))
        const done = () => { clearTimeout(t); this.off('outbound', done); resolve() }
        this.on('outbound', done)
      })
    }
    return this.outbox.slice(0, count)
  }

  /** A stored file by the id an outbound record carries (`media.mediaId`). */
  resolveMedia(id: string): StoredMedia | undefined {
    return this.media.peek(id)
  }

  /** Public description for the hub / UI. */
  describe(): { channel: ChannelName; title: string; url: string; webhookUrl?: string; user: SimUser } {
    return {
      channel: this.channel,
      title: this.title,
      url: this.started ? this.url : '',
      ...(this.webhookUrl ? { webhookUrl: this.webhookUrl } : {}),
      user: this.defaultUser,
    }
  }

  /* --- for subclasses ---------------------------------------------------- */

  protected user(input: UserInput): SimUser {
    return { ...this.defaultUser, ...(input.user ?? {}) } as SimUser
  }

  /**
   * Register an API endpoint. `send` endpoints are subject to faults; `schema`
   * (or `check`) validates the request body against the documented shape.
   */
  protected api(
    method: string,
    pattern: string,
    handler: SimHandler,
    opts: { send?: boolean | ((req: SimRequest) => boolean); schema?: (req: SimRequest) => { schema: Schema; value: unknown } | undefined; check?: (req: SimRequest) => string[] | Promise<string[]>; auth?: (req: SimRequest) => boolean } = {},
  ): void {
    this.router.add(method, pattern, async (req) => {
      const rec: RecordedRequest = { method: req.method, path: req.path, at: Date.now(), status: 0, issues: [] }
      this.requests.push(rec)
      try {
        if (opts.auth && !opts.auth(req)) {
          const out = this.faultResponse('auth', req, 0)
          rec.status = out.status
          rec.fault = 'auth'
          return out
        }
        if (opts.send === true || (typeof opts.send === 'function' && opts.send(req))) {
          const fault = this.takeFault(req)
          if (fault) {
            const out = this.faultResponse(fault.kind, req, fault.retryAfterSec)
            rec.status = out.status
            rec.fault = fault.kind
            return out
          }
        }
        if (opts.schema) {
          const target = opts.schema(req)
          if (target) rec.issues.push(...validate(target.schema, target.value))
        }
        if (opts.check) rec.issues.push(...(await opts.check(req)))
        if (rec.issues.length > 0) {
          this.emit('issue', { method: req.method, path: req.path, issues: rec.issues })
          if (this.strict) {
            const out = this.invalidResponse(rec.issues, req)
            rec.status = out.status
            return out
          }
        }
        const out = await handler(req)
        rec.status = out.status
        return out
      } catch (err) {
        rec.status = 500
        rec.issues.push(`simulator error: ${err instanceof Error ? err.message : String(err)}`)
        return { status: 500, body: { error: 'simulator error' } }
      } finally {
        this.emit('request', rec)
      }
    })
  }

  private takeFault(req: SimRequest): FaultRule | undefined {
    const rule = this.faults.find((f) => f.times > 0 && (!f.match || f.match(req)))
    if (!rule) return undefined
    rule.times -= 1
    if (rule.times <= 0) this.faults = this.faults.filter((f) => f !== rule)
    return rule
  }

  protected recordOutbound(rec: Omit<OutboundRecord, 'channel' | 'at'> & { at?: number }): OutboundRecord {
    const full: OutboundRecord = { ...rec, channel: this.channel, at: rec.at ?? Date.now() } as OutboundRecord
    this.outbox.push(full)
    this.emit('outbound', full)
    const isMessage = !['action', 'edit', 'delete', 'reaction'].includes(full.kind)
    if (this.autoStatus && isMessage && full.id) this.scheduleStatuses(full.id)
    return full
  }

  protected recordInbound(rec: InboundRecord): void {
    this.inbox.push(rec)
    this.emit('inbound', rec)
  }

  private scheduleStatuses(id: string): void {
    const steps: MessageStatus[] = this.autoStatus === 'read' ? ['delivered', 'read'] : ['delivered']
    let delay = 0
    for (const s of steps) {
      delay += 150
      const t = setTimeout(() => {
        this.pendingTimers.delete(t)
        if (!this.started) return
        void this.status(id, s).catch((err: unknown) => this.emit('error', err))
      }, delay)
      t.unref?.()
      this.pendingTimers.add(t)
    }
  }

  /**
   * POST a webhook to the bot, retrying on failure like the platform does
   * (`webhookRetries`). Every attempt is recorded in {@link deliveries}.
   */
  protected async postWebhook(body: string | Buffer, headers: Record<string, string>, url = this.webhookUrl): Promise<DeliveryRecord[]> {
    if (!url) throw new Error(`${this.channel} simulator has no webhook URL: call setWebhook(url) first`)
    const out: DeliveryRecord[] = []
    for (let attempt = 1; attempt <= this.webhookRetries + 1; attempt++) {
      const rec: DeliveryRecord = { url, status: 0, ok: false, attempt, at: Date.now() }
      try {
        const res = await fetch(url, { method: 'POST', headers, body: typeof body === 'string' ? body : new Uint8Array(body) })
        await res.arrayBuffer().catch(() => undefined)
        rec.status = res.status
        rec.ok = res.ok
      } catch (err) {
        rec.error = err instanceof Error ? err.message : String(err)
      }
      out.push(rec)
      this.deliveries.push(rec)
      this.emit('delivery', rec)
      if (rec.ok) break
      if (attempt <= this.webhookRetries) await new Promise((r) => setTimeout(r, this.webhookRetryDelayMs))
    }
    return out
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Buffer
    try {
      body = await readBody(req)
    } catch {
      writeResponse(res, { status: 413, body: { error: 'Request Entity Too Large' } })
      return
    }
    const base = toSimRequest(req, body)
    const match = this.router.match(base.method, base.path)
    try {
      const out = match ? await match.handler({ ...base, params: match.params }) : this.notFound(base)
      writeResponse(res, out)
    } catch (err) {
      writeResponse(res, { status: 500, body: { error: err instanceof Error ? err.message : 'simulator error' } })
    }
  }
}

/** Header value as one string. */
export function bearer(req: SimRequest): string | undefined {
  const h = req.header('authorization')
  return h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : undefined
}
