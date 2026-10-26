/**
 * restClient — thin fetch wrapper over the Discord REST API (v10). Node global
 * fetch with a per-request timeout; maps Discord errors to the core's typed provider errors.
 */

import {
  PayloadTooLargeError,
  ProviderError,
  RateLimitedError,
  RecipientUnreachableError,
  type ChatId,
} from '@botmesh/core'
import type { DiscordApiErrorBody, DiscordMessageResponse } from './types.js'
import type { DiscordFile } from './toOutbound.js'
import { secureFetch, type SecureFetchOptions } from '@botmesh/http'

export interface DiscordRestClientConfig {
  token: string
  /** Base URL without the version, e.g. 'https://discord.com/api'. */
  apiUrl: string
  /** E.g. 'v10'. */
  apiVersion: string
  mediaDownload?: Omit<SecureFetchOptions, 'fetch'>
  /** Time allowed for each request, body included, in ms. Default {@link DEFAULT_REST_TIMEOUT_MS}. */
  requestTimeoutMs?: number
  /** @deprecated Use `requestTimeoutMs`. */
  timeoutMs?: number
  /** Time allowed for a multipart (file upload) request, in ms. Default {@link DEFAULT_UPLOAD_TIMEOUT_MS}. */
  uploadTimeoutMs?: number
}

/** Default time allowed for one REST request: 60 s. */
export const DEFAULT_REST_TIMEOUT_MS = 60_000
/** Default time allowed for one file upload: 5 minutes. */
export const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000

/**
 * JSON error codes meaning the target cannot be reached: Unknown Channel
 * (10003), Unknown User (10013), Missing Access (50001), Cannot send messages
 * to this user (50007).
 */
const UNREACHABLE_CODES = new Set([10_003, 10_013, 50_001, 50_007])

/** Translate a Discord REST error into a typed provider error. */
export function toProviderError(chatId: ChatId, status: number, body: DiscordApiErrorBody): ProviderError {
  const msg = body.message ?? 'Discord API error'
  const detail = `${msg}${body.code ? ` (code ${body.code})` : ''} (HTTP ${status})`
  if (status === 429) {
    const sec = typeof body.retry_after === 'number' && Number.isFinite(body.retry_after) && body.retry_after > 0 ? body.retry_after : 1
    // Capped at 24 h like the other channels (more would overflow setTimeout).
    const ms = Math.min(86_400_000, Math.ceil(sec * 1000))
    return new RateLimitedError(ms, detail)
  }
  // 40003: "You are opening direct messages too fast" (a per-account rate limit).
  if (body.code === 40_003) return new RateLimitedError(body.retry_after ? Math.ceil(body.retry_after * 1000) : 5_000, detail)
  if (status === 403 || (body.code !== undefined && UNREACHABLE_CODES.has(body.code))) {
    return new RecipientUnreachableError(chatId, detail)
  }
  // 40005: "Request entity too large".
  if (status === 413 || body.code === 40_005) return new PayloadTooLargeError(detail)
  return new ProviderError(detail)
}

export class DiscordRestClient {
  constructor(private readonly cfg: DiscordRestClientConfig) {}

  base(path: string): string {
    return `${this.cfg.apiUrl.replace(/\/+$/, '')}/${this.cfg.apiVersion}/${path}`
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bot ${this.cfg.token}` }
  }

  /** Build multipart form-data: `payload_json` + `files[n]`. */
  static toForm(payload: Record<string, unknown>, files: DiscordFile[]): FormData {
    const form = new FormData()
    form.append('payload_json', JSON.stringify(payload))
    files.forEach((f, i) => {
      form.append(
        `files[${i}]`,
        new Blob([new Uint8Array(f.buffer)], { type: f.contentType ?? 'application/octet-stream' }),
        f.name,
      )
    })
    return form
  }

  async request(
    method: string,
    path: string,
    opts: { chatId?: ChatId; json?: unknown; form?: FormData } = {},
  ): Promise<Record<string, unknown>> {
    const headers = this.headers()
    let body: string | FormData | undefined
    if (opts.form) {
      body = opts.form
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }
    // Every request is bounded: a hung connection must not stall a send forever.
    const timeoutMs = opts.form
      ? (this.cfg.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS)
      : (this.cfg.requestTimeoutMs ?? this.cfg.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    let res: Response
    let parsed: DiscordApiErrorBody & Record<string, unknown>
    try {
      res = await fetch(this.base(path), { method, headers, body, signal: controller.signal })
      parsed = (await res.json().catch((err: unknown) => {
        if (controller.signal.aborted) throw err
        return {}
      })) as DiscordApiErrorBody & Record<string, unknown>
    } catch (err) {
      // Never the URL (an interaction route carries its token) nor the bot token.
      const wrapped = new ProviderError(controller.signal.aborted
        ? `Discord API request timed out after ${timeoutMs}ms (${method})`
        : `Discord API request failed (${method}): ${err instanceof Error ? err.name : 'network error'}`)
      ;(wrapped as { cause?: unknown }).cause = err
      throw wrapped
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw toProviderError(opts.chatId ?? '', res.status, parsed)
    return parsed
  }

  /** POST /channels/{channelId}/messages (JSON or multipart when files). */
  async sendMessage(channelId: ChatId, payload: Record<string, unknown>, files?: DiscordFile[]): Promise<DiscordMessageResponse> {
    return this.request('POST', `channels/${channelId}/messages`, {
      chatId: channelId,
      ...(files?.length ? { form: DiscordRestClient.toForm(payload, files) } : { json: payload }),
    }) as Promise<DiscordMessageResponse>
  }

  /** POST /webhooks/{appId}/{interactionToken} — followup inside an interaction. */
  async sendFollowup(appId: string, interactionToken: string, payload: Record<string, unknown>, files?: DiscordFile[]): Promise<DiscordMessageResponse> {
    return this.request('POST', `webhooks/${appId}/${interactionToken}`, {
      ...(files?.length ? { form: DiscordRestClient.toForm(payload, files) } : { json: payload }),
    }) as Promise<DiscordMessageResponse>
  }

  /** PATCH /channels/{channelId}/messages/{messageId}. */
  async editMessage(channelId: ChatId, messageId: string, payload: Record<string, unknown>, files?: DiscordFile[]): Promise<DiscordMessageResponse> {
    return this.request('PATCH', `channels/${channelId}/messages/${messageId}`, {
      chatId: channelId,
      ...(files?.length ? { form: DiscordRestClient.toForm(payload, files) } : { json: payload }),
    }) as Promise<DiscordMessageResponse>
  }

  /** DELETE /channels/{channelId}/messages/{messageId}. */
  async deleteMessage(channelId: ChatId, messageId: string): Promise<void> {
    await this.request('DELETE', `channels/${channelId}/messages/${messageId}`, { chatId: channelId })
  }

  /** PUT /channels/{channelId}/messages/{messageId}/reactions/{emoji}/@me. */
  async putReaction(channelId: ChatId, messageId: string, emoji: string): Promise<void> {
    await this.request('PUT', `channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { chatId: channelId })
  }

  /** DELETE /channels/{channelId}/messages/{messageId}/reactions/{emoji}/@me. */
  async deleteOwnReaction(channelId: ChatId, messageId: string, emoji: string): Promise<void> {
    await this.request('DELETE', `channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { chatId: channelId })
  }

  /** POST /channels/{channelId}/typing. */
  async triggerTyping(channelId: ChatId): Promise<void> {
    await this.request('POST', `channels/${channelId}/typing`, { chatId: channelId })
  }

  /** POST /interactions/{interactionId}/{token}/callback (type 4 or 6). */
  async ackInteraction(interactionId: string, token: string, callback: Record<string, unknown>): Promise<void> {
    await this.request('POST', `interactions/${interactionId}/${token}/callback`, { json: callback })
  }

  /** Plain HTTPS GET (Discord CDN media urls need no auth). */
  async download(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const { response: res, body } = await secureFetch(url, this.cfg.mediaDownload)
    if (!res.ok) throw new ProviderError(`Media download failed: HTTP ${res.status}`)
    return {
      buffer: body,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    }
  }
}
