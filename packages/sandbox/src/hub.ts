/**
 * The sandbox hub: starts the simulators, a bot on every channel (the demo
 * bot, the bakery example or your own setup) and a small web server with the
 * chat UI (`ui/index.html`, no build step) plus a JSON + Server-Sent-Events
 * API the page uses.
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Bot, IProvider, LoggerLike } from '@botmesh/core'
import { listen, readBody, writeResponse, type Listening } from './sim/http.js'
import type { ChannelName, FaultKind, MediaKind, MessageStatus, PlatformSimulator, UserInput } from './sim/base.js'
import { CHANNELS, connectBot, createSimulator } from './providers.js'
import type { Harness } from './harness.js'
import { productSvg, setupDemoBot } from './demo.js'

export interface SandboxOptions {
  /** Channels to start. Default: all of {@link CHANNELS}. */
  channels?: readonly ChannelName[]
  /** UI port. Default 4610 (0 = any free port). */
  port?: number
  /** Bind address. Default `127.0.0.1`. */
  host?: string
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
  sims: Partial<Record<ChannelName, PlatformSimulator>>
  harnesses: Partial<Record<ChannelName, Harness<PlatformSimulator, IProvider>>>
  stop(): Promise<void>
}

const UI_FILE = fileURLToPath(new URL('../ui/index.html', import.meta.url))

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

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res)
    } catch (err) {
      if (!res.headersSent) writeResponse(res, { status: 500, body: { error: err instanceof Error ? err.message : String(err) } })
      else res.end()
    }
  }

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.local')
    const parts = url.pathname.split('/').filter(Boolean)
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      writeResponse(res, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: await readFile(UI_FILE, 'utf8') })
      return
    }
    if (req.method === 'GET' && parts[0] === 'assets' && parts[1]?.endsWith('.svg')) {
      writeResponse(res, { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: productSvg(parts[1].slice(0, -4)) })
      return
    }
    if (parts[0] !== 'api') {
      writeResponse(res, { status: 404, body: { error: 'not found' } })
      return
    }
    if (req.method === 'GET' && parts[1] === 'events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (req.method === 'GET' && parts[1] === 'channels') {
      writeResponse(res, { status: 200, body: channels.map((c) => ({ ...sims[c]!.describe(), ready: harnesses[c]?.bot.getConnectionState() ?? 'stopped' })) })
      return
    }
    const channel = parts[1] as ChannelName
    const sim = sims[channel]
    if (!sim) {
      writeResponse(res, { status: 404, body: { error: `unknown channel ${channel}` } })
      return
    }
    const body = req.method === 'POST' ? JSON.parse((await readBody(req, 32 * 1024 * 1024)).toString('utf8') || '{}') as Record<string, unknown> : {}
    switch (`${req.method} ${parts[2] ?? ''}`) {
      case 'GET timeline':
        writeResponse(res, { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inbox: sim.inbox, outbox: sim.outbox, requests: sim.requests.slice(-200), deliveries: sim.deliveries.slice(-200) }, compact) })
        return
      case 'POST send': {
        const input = toUserInput(body)
        const out = await sim.send(input)
        writeResponse(res, { status: 200, body: out })
        return
      }
      case 'POST fault':
        sim.fail(String(body['kind']) as FaultKind, { times: Number(body['times'] ?? 1), retryAfterSec: Number(body['retryAfterSec'] ?? 30) })
        writeResponse(res, { status: 200, body: { ok: true } })
        return
      case 'POST status':
        writeResponse(res, { status: 200, body: await sim.status(String(body['messageId']), String(body['status']) as MessageStatus) })
        return
      case 'POST reset':
        sim.reset()
        writeResponse(res, { status: 200, body: { ok: true } })
        return
      case 'GET media': {
        const item = sim.resolveMedia(parts[3] ?? '')
        if (!item) { writeResponse(res, { status: 404, body: { error: 'no such media' } }); return }
        writeResponse(res, { status: 200, headers: { 'content-type': item.mimetype }, body: item.data })
        return
      }
      default:
        writeResponse(res, { status: 404, body: { error: 'not found' } })
    }
  }

  try {
    ui = await listen((req, res) => { void handler(req, res) }, { port: opts.port ?? 4610, host })
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

/** Translate the UI's JSON into a {@link UserInput}. Media arrive base64-encoded. */
export function toUserInput(body: Record<string, unknown>): UserInput {
  const input: UserInput = {}
  if (body['user'] && typeof body['user'] === 'object') input.user = body['user'] as UserInput['user'] & object
  if (typeof body['text'] === 'string') input.text = body['text']
  const media = body['media'] as { kind?: string; base64?: string; mimetype?: string; filename?: string; caption?: string } | undefined
  if (media?.base64) {
    input.media = {
      kind: (media.kind ?? 'document') as MediaKind,
      data: Buffer.from(media.base64, 'base64'),
      ...(media.mimetype ? { mimetype: media.mimetype } : {}),
      ...(media.filename ? { filename: media.filename } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
    }
  }
  const loc = body['location'] as { latitude?: unknown; longitude?: unknown; name?: unknown; address?: unknown } | undefined
  if (loc) {
    input.location = {
      latitude: Number(loc.latitude), longitude: Number(loc.longitude),
      ...(typeof loc.name === 'string' && loc.name ? { name: loc.name } : {}),
      ...(typeof loc.address === 'string' && loc.address ? { address: loc.address } : {}),
    }
  }
  const reply = body['reply'] as { kind?: string; id?: string; title?: string; messageId?: string } | undefined
  if (reply?.id) input.reply = { kind: reply.kind === 'list' ? 'list' : 'button', id: reply.id, ...(reply.title ? { title: reply.title } : {}), ...(reply.messageId ? { messageId: reply.messageId } : {}) }
  const vote = body['pollVote'] as { pollId?: string; optionIds?: number[] } | undefined
  if (vote?.pollId) input.pollVote = { pollId: vote.pollId, optionIds: vote.optionIds ?? [] }
  if (typeof body['quotedId'] === 'string') input.quotedId = body['quotedId']
  return input
}
