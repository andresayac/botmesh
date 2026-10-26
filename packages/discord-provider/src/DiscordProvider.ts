/**
 * DiscordProvider — Discord transport for @botmesh/core. Gateway websocket for
 * inbound events (pushIngress: false — the provider owns the socket), REST for
 * outbound sends. Buttons / select menus / slash commands arrive as
 * interactions and MUST be acknowledged within ~3s (interactionsRequireAck).
 *
 * @example
 * ```ts
 * const provider = new DiscordProvider({ token: process.env.DISCORD_TOKEN! })
 * const bot = new Bot({ provider })
 * bot.when('hola', (ctx) => ctx.reply('👋 ¡Hola desde Discord!'))
 * await bot.start()
 * ```
 */

import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import pino from 'pino'
import type { LoggerLike } from '@botmesh/core'
import type {
  ChatId,
  IProvider,
  InboundEvent,
  MediaRef,
  MediaSource,
  MessageRef,
  OutboundContent,
  ProviderCapabilities,
  SendOptions,
  SendResult,
  UserId,
  SerializedMediaRef,
} from '@botmesh/core'
import { ProviderError, UnsupportedContentError } from '@botmesh/core'
import { isAllowedHostUrl } from '@botmesh/http'
import type { DiscordProviderConfig } from './types.js'
import { DEFAULT_INTENTS } from './types.js'
import { GatewaySocket, defaultSocketFactory } from './gateway.js'
import { DiscordRestClient } from './restClient.js'
import { parseDispatch } from './parseInbound.js'
import { toOutbound, type DiscordFile } from './toOutbound.js'

/** Default `reactionMemory`: messages whose own-reaction emoji is remembered. */
const DEFAULT_REACTION_MEMORY = 1000

/** Hosts (and their subdomains) that serve Discord attachments (`cdn.discordapp.com`, `media.discordapp.net`). */
export const DISCORD_MEDIA_HOSTS: readonly string[] = Object.freeze(['discordapp.com', 'discordapp.net'])

const MEDIA_KINDS = ['image', 'video', 'audio', 'voice', 'document', 'sticker'] as const

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', aac: 'audio/aac', wav: 'audio/wav',
  pdf: 'application/pdf', doc: 'application/msword', txt: 'text/plain',
}

const DEFAULT_NAME: Record<string, string> = {
  image: 'image.png', video: 'video.mp4', audio: 'audio.mp3',
  voice: 'voice.ogg', sticker: 'sticker.png', document: 'document.bin',
}

function mimeFor(path: string): string | undefined {
  return EXT_MIME[path.split('.').pop()?.toLowerCase() ?? '']
}

/** Default delay before an unanswered interaction is deferred automatically (Discord allows 3 s). */
const DEFAULT_AUTO_ACK_MS = 2000
/** Discord interaction tokens are valid for 15 minutes. */
const INTERACTION_TOKEN_TTL_MS = 15 * 60_000
/** Most interaction tokens remembered at once. */
const MAX_INTERACTIONS = 1000

export class DiscordProvider implements IProvider<unknown> {
  readonly id = 'discord'
  readonly capabilities: ProviderCapabilities = {
    contentKinds: [
      'text', 'image', 'video', 'audio', 'voice', 'document', 'sticker',
      'location', 'contact', 'poll', 'reaction', 'buttons', 'list', 'card', 'native',
    ],
    maxTextLength: 2000,
    buttons: true,
    lists: true,
    polls: true,
    reactions: true,
    edit: true,
    typing: true,
    presence: false,
    readReceipts: false,
    groups: true,
    templates: false,
    interactionsRequireAck: true,
    pushIngress: false,
    exclusiveSession: true, // one gateway connection per bot token (no sharding): one replica connects
    streaming: 'edit', // ctx.stream(): send once, then throttled message edits
    forms: 'degraded', // flow().form() asks field by field
    textFormat: 'markdown', // Discord renders Markdown natively
  }

  private readonly config: Required<
    Pick<DiscordProviderConfig, 'intents' | 'gatewayUrl' | 'apiUrl' | 'apiVersion' | 'reconnectDelayMs'>
  > & DiscordProviderConfig
  private readonly logger: LoggerLike
  private readonly rest: DiscordRestClient
  private gateway: GatewaySocket | null = null
  private listeners = new Set<(e: InboundEvent) => void | Promise<void>>()
  private _selfId: UserId | null
  /**
   * `channelId \0 messageId` → the emoji the bot last reacted with (bounded LRU,
   * `reactionMemory` entries). Discord removes a reaction by emoji, so this is
   * what lets an empty-emoji `react('')` remove it and a new emoji replace it.
   */
  private readonly ownReactions = new Map<string, string>()
  private readonly reactionMemory: number
  /**
   * Interaction id → its token (valid 15 minutes) and ack state. The token never leaves
   * the provider: `interactionId` is the bare id. Bounded by TTL and size.
   */
  private readonly interactions = new Map<string, { token: string; command: boolean; acked: boolean; at: number; timer?: ReturnType<typeof setTimeout> }>()
  private readonly autoAckMs: number | false

  constructor(config: DiscordProviderConfig) {
    if (typeof config.token !== 'string' || config.token.trim() === '') {
      throw new Error('DiscordProvider requires `token` (Developer Portal → Bot → Reset Token); got an empty value — is the env var set?')
    }
    const memory = config.reactionMemory ?? DEFAULT_REACTION_MEMORY
    if (!Number.isSafeInteger(memory) || memory < 0) {
      throw new Error(`DiscordProvider: reactionMemory must be a non-negative integer (got ${String(memory)})`)
    }
    this.reactionMemory = memory
    const autoAck = config.autoAckMs ?? DEFAULT_AUTO_ACK_MS
    if (autoAck !== false && !(typeof autoAck === 'number' && Number.isFinite(autoAck) && autoAck >= 0 && autoAck < 3000)) {
      throw new TypeError(`DiscordProvider: autoAckMs must be false or a number of ms below 3000 (Discord's deadline), got ${String(autoAck)}`)
    }
    this.autoAckMs = autoAck
    for (const field of ['requestTimeoutMs', 'uploadTimeoutMs'] as const) {
      const v = config[field]
      if (v !== undefined && !(Number.isFinite(v) && v > 0 && v <= 2 ** 31 - 1)) {
        throw new TypeError(`DiscordProvider: ${field} must be a positive number of milliseconds`)
      }
    }
    if (config.mediaRefHosts !== undefined &&
      (!Array.isArray(config.mediaRefHosts) || config.mediaRefHosts.some((h) => typeof h !== 'string' || h.trim() === ''))) {
      throw new TypeError('DiscordProvider: mediaRefHosts must be an array of host names')
    }
    this.config = {
      intents: DEFAULT_INTENTS,
      gatewayUrl: 'wss://gateway.discord.gg',
      apiUrl: 'https://discord.com/api',
      apiVersion: 'v10',
      reconnectDelayMs: 500,
      ...config,
    }
    this.logger = config.logger ?? pino({ level: config.debug ? 'debug' : 'error' })
    this.rest = new DiscordRestClient({
      token: this.config.token,
      apiUrl: this.config.apiUrl,
      apiVersion: this.config.apiVersion,
      mediaDownload: this.config.mediaDownload,
      ...(this.config.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.config.requestTimeoutMs } : {}),
      ...(this.config.uploadTimeoutMs !== undefined ? { uploadTimeoutMs: this.config.uploadTimeoutMs } : {}),
    })
    this._selfId = config.selfId ?? null
  }

  get selfId(): UserId | null { return this._selfId }
  /** Debug-only live gateway socket handle. Core must NOT reach through it. */
  get connection(): unknown { return this.gateway?.rawSocket ?? null }

  /* Events ---------------------------------------------------------------- */

  onEvent(listener: (e: InboundEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private fan(e: InboundEvent): void {
    for (const listener of this.listeners) {
      try {
        void Promise.resolve(listener(e))
          .catch((error) => this.logger.error({ err: error, eventKind: e.kind }, 'provider event listener failed'))
      } catch (error) {
        this.logger.error({ err: error, eventKind: e.kind }, 'provider event listener failed')
      }
    }
  }

  /* Lifecycle --------------------------------------------------------------- */

  async start(): Promise<void> {
    this.gateway = new GatewaySocket({
      token: this.config.token,
      intents: this.config.intents,
      gatewayUrl: this.config.gatewayUrl,
      reconnectDelayMs: this.config.reconnectDelayMs,
      socketFactory: this.config.socketFactory ?? defaultSocketFactory,
      logger: this.logger,
      dispatch: (t, d) => this.onGatewayDispatch(t, d),
      connection: (update) => this.fan({ kind: 'connection', update }),
    })
    await this.gateway.connect()
  }

  async stop(): Promise<void> {
    await this.gateway?.stop()
    this.gateway = null
    for (const entry of this.interactions.values()) if (entry.timer) clearTimeout(entry.timer)
    this.interactions.clear()
  }

  private onGatewayDispatch(t: string, d: unknown): void {
    if (t === 'READY') {
      const user = (d as { user?: { id: string } } | undefined)?.user
      if (user?.id && !this._selfId) this._selfId = user.id
      this.fan({ kind: 'connection', update: { state: 'ready' } })
    } else if (t === 'RESUMED') {
      // A resumed session is live again: without this the connection would
      // stay 'authenticating' after every successful RESUME.
      this.fan({ kind: 'connection', update: { state: 'ready' } })
    }
    const event = parseDispatch(t, d, this._selfId)
    if (event?.kind === 'interaction') this.rememberInteraction(d)
    if (event) this.fan(event)
  }

  /** Keep the token of an incoming interaction (by id) and arm its auto-ack. */
  private rememberInteraction(d: unknown): void {
    const { id, token, type } = (d ?? {}) as { id?: unknown; token?: unknown; type?: unknown }
    if (typeof id !== 'string' || typeof token !== 'string' || !id || !token) return
    const now = Date.now()
    for (const [key, entry] of this.interactions) {
      if (now - entry.at <= INTERACTION_TOKEN_TTL_MS && this.interactions.size < MAX_INTERACTIONS) break
      if (entry.timer) clearTimeout(entry.timer)
      this.interactions.delete(key)
    }
    const entry: { token: string; command: boolean; acked: boolean; at: number; timer?: ReturnType<typeof setTimeout> } = {
      token, command: type === 2, acked: false, at: now,
    }
    if (this.autoAckMs !== false) {
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        if (entry.acked) return
        entry.acked = true
        this.rest.ackInteraction(id, token, { type: entry.command ? 5 : 6 })
          .catch((err: unknown) => this.logger.warn({ err }, 'discord: automatic interaction acknowledgement failed'))
      }, this.autoAckMs)
      entry.timer.unref?.()
    }
    this.interactions.set(id, entry)
  }

  /** The token for an `interactionId` (a remembered id, or the old `<id>:<token>` form). */
  private interactionToken(interactionId: string): { id: string; token: string } | undefined {
    const known = this.interactions.get(interactionId)
    if (known) return { id: interactionId, token: known.token }
    const sep = interactionId.indexOf(':')
    return sep > 0 ? { id: interactionId.slice(0, sep), token: interactionId.slice(sep + 1) } : undefined
  }

  /* Outbound ---------------------------------------------------------------- */

  /**
   * Set, replace or remove the bot's own reaction on a message. Discord allows
   * many reactions per user and removes them by emoji, so the provider remembers
   * the emoji it set (bounded by `reactionMemory`):
   *  - a new emoji is added, then the previous one is removed (one reaction per
   *    message, as on WhatsApp/Telegram); removing the old one is best-effort;
   *  - an empty emoji removes the remembered one, or rejects with
   *    `UnsupportedContentError` when it is unknown (set in a previous process,
   *    evicted, or `reactionMemory: 0`).
   */
  private async react(channelId: ChatId, messageId: string, emoji: string): Promise<void> {
    const key = `${channelId}\u0000${messageId}`
    const previous = this.ownReactions.get(key)
    if (!emoji) {
      if (!previous) {
        throw new UnsupportedContentError(
          'reaction',
          'Discord removes a reaction by its emoji and this provider does not remember one for that message ' +
            '(set before a restart, evicted from reactionMemory, or reactionMemory is 0).',
        )
      }
      await this.rest.deleteOwnReaction(channelId, messageId, previous)
      this.ownReactions.delete(key)
      return
    }
    await this.rest.putReaction(channelId, messageId, emoji)
    if (this.reactionMemory === 0) return
    this.ownReactions.delete(key)
    this.ownReactions.set(key, emoji)
    while (this.ownReactions.size > this.reactionMemory) {
      const oldest = this.ownReactions.keys().next().value
      if (oldest === undefined) break
      this.ownReactions.delete(oldest)
    }
    if (previous && previous !== emoji) {
      await this.rest.deleteOwnReaction(channelId, messageId, previous).catch((err: unknown) => {
        this.logger.warn({ err }, 'could not remove the previous reaction')
      })
    }
  }

  async send(chatId: ChatId, content: OutboundContent, options?: SendOptions): Promise<SendResult<unknown>> {
    // Reactions live on their own REST route.
    if (content.kind === 'reaction') {
      await this.react(content.target.chatId || chatId, content.target.id, content.emoji)
      return { ref: content.target }
    }

    const { payload, files } = toOutbound(content, await this.mediaFileOf(content))

    if (options?.quoted) {
      payload.message_reference = {
        message_id: options.quoted.id,
        channel_id: options.quoted.chatId || chatId,
        fail_if_not_exists: false,
      }
    }
    if (options?.mentions?.length) {
      payload.allowed_mentions = { users: options.mentions }
    }
    if (options?.platformData) Object.assign(payload, options.platformData)

    // Reply INTO an interaction (Discord followup) when we can.
    const followup = options?.interactionId ? this.interactionToken(options.interactionId) : undefined
    if (followup && this.config.appId) {
      const body = await this.rest.sendFollowup(this.config.appId, followup.token, payload, files)
      return { ref: { id: body.id ?? '', chatId }, raw: body }
    }

    const body = await this.rest.sendMessage(chatId, payload, files)
    return { ref: { id: body.id ?? '', chatId }, raw: body }
  }

  /* Media ------------------------------------------------------------------- */

  /** The upload for a media kind (undefined for every other kind). */
  private async mediaFileOf(content: OutboundContent): Promise<DiscordFile | undefined> {
    if (!(MEDIA_KINDS as readonly string[]).includes(content.kind)) return undefined
    const name = content.kind === 'document'
      ? ((content as { filename?: string }).filename ?? DEFAULT_NAME.document)
      : DEFAULT_NAME[content.kind] ?? 'file.bin'
    return this.resolveMedia((content as { media: MediaSource }).media, name)
  }

  private async resolveMedia(source: MediaSource, name: string): Promise<DiscordFile> {
    if (typeof source === 'string') {
      return /^https?:\/\//i.test(source)
        ? this.downloadAsFile(source, name)
        : { name: basename(source), buffer: await readFile(source), contentType: mimeFor(source) }
    }
    if (Buffer.isBuffer(source)) return { name, buffer: source, contentType: mimeFor(name) }
    if ('url' in source) return this.downloadAsFile(source.url, name)
    if ('buffer' in source) return { name, buffer: source.buffer, contentType: mimeFor(name) }
    if ('path' in source) {
      return { name: basename(source.path), buffer: await readFile(source.path), contentType: mimeFor(source.path) }
    }
    if ('stream' in source) {
      const chunks: Buffer[] = []
      for await (const c of source.stream as AsyncIterable<Buffer | string>) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
      }
      return { name, buffer: Buffer.concat(chunks) }
    }
    if ('native' in source) {
      if (Buffer.isBuffer(source.native)) return { name, buffer: source.native }
      if (typeof source.native === 'string') return this.resolveMedia(source.native, name)
    }
    throw new UnsupportedContentError('image', 'Unsupported MediaSource for Discord')
  }

  private async downloadAsFile(url: string, name: string): Promise<DiscordFile> {
    const { buffer, contentType } = await this.rest.download(url)
    return { name, buffer, contentType }
  }

  async downloadMedia(ref: MediaRef): Promise<Buffer | NodeJS.ReadableStream> {
    const url = ref.token
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new ProviderError('downloadMedia requires a Discord CDN url (MediaRef.token)')
    }
    return (await this.rest.download(url)).buffer
  }

  /**
   * Durable inbox: the attachment CDN URL (`{ url }`), only on a Discord CDN host (or
   * `mediaRefHosts`). No credentials are stored. Discord signs attachment URLs and they expire
   * (about 24 h): a replay after that fails with the usual download error.
   */
  serializeMediaRef(ref: MediaRef): SerializedMediaRef | undefined {
    return typeof ref.token === 'string' && this.mediaUrlAllowed(ref.token) ? { v: 1, data: { url: ref.token } } : undefined
  }

  /** Rebuild a journaled attachment URL. @throws {ProviderError} on an invalid, foreign or unknown-version value. */
  rehydrateMediaRef(stored: SerializedMediaRef, ref: Omit<MediaRef, 'token'>): MediaRef {
    const data = stored?.data as { url?: unknown } | null | undefined
    const url = stored?.v === 1 && data !== null && typeof data === 'object' && !Array.isArray(data) ? data.url : undefined
    if (typeof url !== 'string' || !this.mediaUrlAllowed(url)) throw new ProviderError('Invalid Discord media reference')
    return { ...ref, token: url }
  }

  private mediaUrlAllowed(url: string): boolean {
    return isAllowedHostUrl(url, {
      hosts: this.config.mediaRefHosts ?? DISCORD_MEDIA_HOSTS,
      allowHttp: this.config.mediaDownload?.allowHttp === true,
    })
  }

  /* Capability-gated actions -------------------------------------------------- */

  /** Discord has no read-receipt primitive — intentional no-op. */
  async markRead(_refs: MessageRef[]): Promise<void> {}

  /**
   * POST /channels/{id}/typing. Discord shows one indicator for both 'typing'
   * and 'recording'; it has no stop-typing primitive (the indicator expires on
   * its own or when a message is sent), so 'paused' is a no-op.
   */
  async typing(chatId: ChatId, state?: 'typing' | 'recording' | 'paused'): Promise<void> {
    if (state === 'paused') return
    await this.rest.triggerTyping(chatId)
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this.rest.deleteMessage(ref.chatId, ref.id)
  }

  async editMessage(ref: MessageRef, content: OutboundContent): Promise<SendResult<unknown>> {
    if (content.kind === 'reaction') throw new UnsupportedContentError('reaction', 'Cannot edit a message into a reaction')
    const { payload, files } = toOutbound(content, await this.mediaFileOf(content))
    // PATCH keeps every field it is not sent: without an explicit empty list the old
    // buttons / select menu stay under the edited content (and stay pressable).
    if (content.kind !== 'native' && !('components' in payload)) payload.components = []
    await this.rest.editMessage(ref.chatId, ref.id, payload, files)
    return { ref }
  }

  /**
   * Answer an interaction before the ~3s deadline. `interactionId` is the
   * `<id>:<token>` pair emitted on the InboundInteraction. With `text` posts
   * an immediate response (type 4); otherwise defers (type 6).
   */
  async acknowledgeInteraction(interactionId: string, opts?: { text?: string; defer?: boolean }): Promise<void> {
    const target = this.interactionToken(interactionId)
    if (!target) {
      throw new ProviderError('acknowledgeInteraction: unknown interaction (its token expired after 15 minutes, or it reached another process)')
    }
    const entry = this.interactions.get(target.id)
    const text = opts?.text && !opts?.defer ? opts.text : undefined
    if (entry?.acked) {
      // Already answered (by the bot or the automatic defer): a text can only follow up.
      if (text === undefined) return
      if (!this.config.appId) {
        this.logger.warn('discord: the interaction was already acknowledged; set appId to send this text as a followup')
        return
      }
      await this.rest.sendFollowup(this.config.appId, target.token, { content: text })
      return
    }
    if (entry) {
      entry.acked = true
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined }
    }
    const callback = text !== undefined
      ? { type: 4, data: { content: text } }
      : { type: entry?.command ? 5 : 6 }
    try {
      await this.rest.ackInteraction(target.id, target.token, callback)
    } catch (err) {
      if (entry) entry.acked = false
      throw err
    }
  }
}
