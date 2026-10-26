/**
 * The sandbox hub: starts the simulators, a bot on every channel (the demo
 * bot, the bakery example or your own setup) and a small web server with the
 * chat UI (`ui/index.html`, no build step) plus a JSON + Server-Sent-Events
 * API the page uses.
 *
 * The API is local-only by design: it binds to 127.0.0.1, checks `Host` and
 * `Origin` on every request (see `guard.ts`), requires a random per-run
 * token on state-changing calls, bounds request bodies and answers bad input
 * with a 4xx JSON error (see `hubInput.ts`).
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Bot, IProvider, LoggerLike } from '@botmesh/core'
import { listen, readBody, writeResponse, type Listening } from './sim/http.js'
import type { ChannelName, PlatformSimulator } from './sim/base.js'
import { CHANNELS, POLL_VOTE_PARSING, connectBot, createSimulator } from './providers.js'
import { HttpError, createGuard, isLoopbackHost, newSandboxToken, type RequestGuard } from './guard.js'
import { parseJsonObject, toFault, toStatus, toUserInput } from './hubInput.js'
import type { Harness } from './harness.js'
import { productSvg, setupDemoBot } from './demo.js'

export interface SandboxOptions {
  /** Channels to start. Default: all of {@link CHANNELS}. */
  channels?: readonly ChannelName[]
  /** UI port. Default 4610 (0 = any free port). */
  port?: number
  /** Bind address. Default `127.0.0.1` (keep it on loopback unless you know why). */
  host?: string
  /**
   * Extra host names accepted in the `Host` / `Origin` headers besides the
   * loopback ones (`127.0.0.1`, `localhost`, `[::1]`) and the bind address.
   * Only needed when the hub is reached through another name on purpose.
   */
  allowedHosts?: readonly string[]
  /** Token required on state-changing API calls. Default: a fresh random one per run. */
  token?: string
  /**
   * How the UI answers a native poll: `'auto'` (default) sends a native vote
   * on channels whose simulator and provider both handle one
   * ({@link POLL_VOTE_PARSING}) and the option text elsewhere; `'text'` or
   * `'native'` force one mode.
   */
  pollVotes?: 'auto' | 'text' | 'native'
  /** Which bot answers: the built-in demo, the bakery example (scripted AI) or your own setup. Default `'demo'`. */
  bot?: 'demo' | 'bakery' | 'none'
  /** Register your own handlers on every channel's bot (runs after the chosen bot). */
  setup?: (bot: Bot, channel: ChannelName) => void | Promise<void>
  /** Build each Bot yourself (wins over `bot`). */
  createBot?: (provider: IProvider, channel: ChannelName) => Bot
  /** Delivered/read receipts after each bot message. Default `'read'`. */
  autoStatus?: false | 'delivered' | 'read'
  /** Telegram transport. Default `'polling'`. */
  telegramMode?: 'polling' | 'webhook'
  logger?: LoggerLike
}

export interface RunningSandbox {
  /** UI URL. */
  url: string
  /** The per-run token state-changing API calls need (header `x-sandbox-token`). */
  token: string
  sims: Partial<Record<ChannelName, PlatformSimulator>>
  harnesses: Partial<Record<ChannelName, Harness<PlatformSimulator, IProvider>>>
  stop(): Promise<void>
}

const UI_FILE = fileURLToPath(new URL('../ui/index.html', import.meta.url))
/** Body limits: `send` carries base64 media, every other call is a few fields. */
const SEND_LIMIT = 32 * 1024 * 1024
const SMALL_LIMIT = 64 * 1024
/** The UI page cannot be framed (clickjacking) and leaks no referrer. */
const PAGE_HEADERS = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }

/**
 * Headers for user-supplied media served from the UI origin: never sniffed,
 * sandboxed (an uploaded HTML or SVG file cannot run script next to the
 * token) and downloaded unless it is plain image/audio/video.
 */
function mediaHeaders(mimetype: string): Record<string, string> {
  const inline = /^(image\/(png|jpe?g|gif|webp)|audio\/|video\/)/i.test(mimetype)
  return { 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'content-disposition': inline ? 'inline' : 'attachment' }
}

/** JSON.stringify replacer: Buffers become `<N bytes>` so events stay small. */
function compact(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && (value as { type?: string }).type === 'Buffer' && Array.isArray((value as { data?: unknown }).data)) {
    return `<${(value as { data: unknown[] }).data.length} bytes>`
  }
  return value
}

/** A scripted bakery model: picks a tool from keywords, then reports its result. */
async function bakeryBot(provider: IProvider, logger: LoggerLike | undefined): Promise<Bot> {
  const { createBakeryBot } = await import('@botmesh/example-bakery-ai/bot')
  const { MockAIProvider } = await import('@botmesh/ai')
  const call = (name: string, args: unknown) => ({ toolCalls: [{ name, args }] })
  const model = new MockAIProvider({
    reply: (input) => {
      const last = input.messages[input.messages.length - 1]
      if (last?.role === 'tool') return last.results.map((r) => `${r.content}`).join('\n')
      const text = last?.role === 'user' ? last.content.toLowerCase() : ''
      if (/men[uú]|menu/.test(text)) return call('view_menu', {})
      if (/precio|cu[aá]nto|how much|quote/.test(text)) return call('quote_order', { items: [{ product: 'croissant', quantity: 2 }, { product: 'coffee', quantity: 1 }] })
      if (/mis pedidos|my orders/.test(text)) return call('my_orders', {})
      if (/pedir|pedido|order/.test(text)) return call('create_order', { items: [{ product: 'croissant', quantity: 2 }, { product: 'coffee', quantity: 1 }] })
      return '🤖 (IA simulada) Puedo mostrarte el *menú*, darte un *precio*, hacer un *pedido* o ver *mis pedidos*.'
    },
  })
  return createBakeryBot(provider, { aiProvider: model, ...(logger ? { logger } : {}) })
}

/** Start the simulators, the bots and the UI. */
export async function startSandbox(opts: SandboxOptions = {}): Promise<RunningSandbox> {
  const channels = opts.channels ?? CHANNELS
  const host = opts.host ?? '127.0.0.1'
  const sims: Partial<Record<ChannelName, PlatformSimulator>> = {}
  const harnesses: Partial<Record<ChannelName, Harness<PlatformSimulator, IProvider>>> = {}
  const clients = new Set<ServerResponse>()
  let ui: Listening | undefined

  const broadcast = (event: string, channel: ChannelName, data: unknown) => {
    const line = `event: ${event}\ndata: ${JSON.stringify({ channel, data }, compact)}\n\n`
    for (const c of clients) c.write(line)
  }

  const token = opts.token ?? newSandboxToken()
  let guard: RequestGuard | undefined
  const pollMode = (sim: PlatformSimulator): 'native' | 'text' => {
    const mode = opts.pollVotes ?? 'auto'
    if (mode !== 'auto') return mode
    return sim.nativePollVotes && POLL_VOTE_PARSING.has(sim.channel) ? 'native' : 'text'
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof Error ? err.message : String(err)
      // A refused body may still be streaming in: close the connection instead of draining it.
      const headers: Record<string, string> = status === 413 || status === 401 || status === 403 ? { connection: 'close' } : {}
      if (!res.headersSent) writeResponse(res, { status, headers, body: { error: message } })
      else res.end()
    }
  }

  const readJson = async (req: IncomingMessage, limit: number): Promise<Record<string, unknown>> => {
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    const length = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(length) && length > limit) throw new HttpError(413, `the body is larger than ${limit} bytes`)
    const empty = length === 0 && req.headers['transfer-encoding'] === undefined
    if (type !== 'application/json' && !(type === '' && empty)) throw new HttpError(415, 'send the body as application/json')
    const raw = await readBody(req, limit).catch(() => { throw new HttpError(413, `the body is larger than ${limit} bytes`) })
    return parseJsonObject(raw)
  }

  const allow = (method: string, allowed: string): void => {
    if (method !== allowed) throw new HttpError(405, `method not allowed (use ${allowed})`)
  }

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method ?? 'GET').toUpperCase()
    // Host / Origin first on every route; the token is checked once the route is known to change state.
    guard!.check(req, { stateChanging: false })
    let url: URL
    try { url = new URL(req.url ?? '/', 'http://sandbox.local') } catch { throw new HttpError(400, 'malformed request URL') }
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      allow(method, 'GET')
      const html = (await readFile(UI_FILE, 'utf8')).replace('<meta name="sandbox-token" content="">', `<meta name="sandbox-token" content="${token}">`)
      writeResponse(res, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...PAGE_HEADERS }, body: html })
      return
    }
    if (parts[0] === 'assets' && parts.length === 2 && parts[1]!.endsWith('.svg')) {
      allow(method, 'GET')
      writeResponse(res, { status: 200, headers: { 'content-type': 'image/svg+xml', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }, body: productSvg(parts[1]!.slice(0, -4)) })
      return
    }
    if (parts[0] !== 'api') throw new HttpError(404, 'not found')
    if (parts[1] === 'events' && parts.length === 2) {
      allow(method, 'GET')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (parts[1] === 'channels' && parts.length === 2) {
      allow(method, 'GET')
      writeResponse(res, { status: 200, body: channels.map((c) => ({ ...sims[c]!.describe(), ready: harnesses[c]?.bot.getConnectionState() ?? 'stopped', pollVotes: pollMode(sims[c]!) })) })
      return
    }
    const channel = parts[1] ?? ''
    // Own keys only: '__proto__', 'constructor'... are unknown channels, not prototype members.
    const sim = Object.hasOwn(sims, channel) ? sims[channel as ChannelName] : undefined
    if (!sim) throw new HttpError(404, `unknown channel ${channel}`)
    const action = parts[2] ?? ''
    if (action === 'timeline' && parts.length === 3) {
      allow(method, 'GET')
      writeResponse(res, { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inbox: sim.inbox, outbox: sim.outbox, requests: sim.requests.slice(-200), deliveries: sim.deliveries.slice(-200) }, compact) })
      return
    }
    if (action === 'media' && parts.length === 4) {
      allow(method, 'GET')
      const item = sim.resolveMedia(parts[3]!)
      if (!item) throw new HttpError(404, 'no such media')
      writeResponse(res, { status: 200, headers: { 'content-type': item.mimetype, ...mediaHeaders(item.mimetype) }, body: item.data })
      return
    }
    if (!['send', 'fault', 'status', 'reset'].includes(action) || parts.length !== 3) throw new HttpError(404, 'not found')
    allow(method, 'POST')
    guard!.check(req, { stateChanging: true })
    const input = await readJson(req, action === 'send' ? SEND_LIMIT : SMALL_LIMIT)
    // A simulator that cannot express an input (a location on Discord...) says so: 422.
    const refused = (err: unknown): never => { throw new HttpError(422, err instanceof Error ? err.message : String(err)) }
    switch (action) {
      case 'send': {
        const userInput = toUserInput(input)
        writeResponse(res, { status: 200, body: await sim.send(userInput).catch(refused) })
        return
      }
      case 'fault': {
        const f = toFault(input)
        sim.fail(f.kind, { times: f.times, retryAfterSec: f.retryAfterSec })
        writeResponse(res, { status: 200, body: { ok: true } })
        return
      }
      case 'status': {
        const st = toStatus(input)
        writeResponse(res, { status: 200, body: await sim.status(st.messageId, st.status).catch(refused) })
        return
      }
      default: {
        if (Object.keys(input).length) throw new HttpError(400, 'reset takes no fields')
        sim.reset()
        writeResponse(res, { status: 200, body: { ok: true } })
      }
    }
  }

  try {
    ui = await listen((req, res) => { void handler(req, res) }, { port: opts.port ?? 4610, host })
    guard = createGuard({ bindHost: host, port: ui.port, token, ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}) })
    if (!isLoopbackHost(host)) opts.logger?.warn({ host }, 'sandbox: the UI is bound to a non-loopback address; anyone who can reach it and knows the token can drive the simulators')
    const assetsUrl = ui.url
    const which = opts.bot ?? 'demo'
    for (const channel of channels) {
      const sim = createSimulator(channel, { autoStatus: opts.autoStatus ?? 'read', host })
      sims[channel] = sim
      for (const event of ['inbound', 'outbound', 'delivery', 'issue'] as const) sim.on(event, (data: unknown) => broadcast(event, channel, data))
      sim.on('error', () => {})
      const createBot = opts.createBot
        ? (provider: IProvider) => opts.createBot!(provider, channel)
        : which === 'bakery' ? (provider: IProvider) => bakeryBot(provider, opts.logger) : undefined
      try {
        harnesses[channel] = await connectBot(sim, async (bot, ch) => {
          if (!createBot && which === 'demo') setupDemoBot(bot, ch, { assetsUrl })
          await opts.setup?.(bot, ch)
        }, {
          ...(opts.logger ? { logger: opts.logger, bot: { logger: opts.logger } } : {}),
          ...(opts.telegramMode ? { telegramMode: opts.telegramMode } : {}),
          ...(createBot ? { createBot } : {}),
        })
      } catch (err) {
        throw new Error(`could not start the ${channel} channel: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    for (const h of Object.values(harnesses)) await h?.stop().catch(() => {})
    for (const s of Object.values(sims)) await s?.stop().catch(() => {})
    for (const c of clients) c.end()
    await ui?.close()
    throw err
  }

  return {
    url: ui.url,
    token,
    sims,
    harnesses,
    async stop() {
      for (const c of clients) c.end()
      clients.clear()
      for (const h of Object.values(harnesses)) await h?.stop().catch(() => {})
      await ui?.close()
    },
  }
}

export { toUserInput } from './hubInput.js'
