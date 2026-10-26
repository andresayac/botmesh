/**
 * @botmesh/messenger — types for the Facebook Messenger (Meta Graph Send API)
 * transport.
 */

import type { SecureFetchOptions } from '@botmesh/http'
import type { LoggerLike } from '@botmesh/core'

export interface MessengerProviderConfig {
  /** Page access token with pages_messaging (from the Meta app dashboard). */
  accessToken: string
  /** Shared secret the host configured in the webhook subscription (GET verify). */
  verifyToken: string
  /**
   * App secret: inbound POSTs are verified against the `X-Hub-Signature-256` header
   * (HMAC-SHA256 over the raw body). Required unless `allowUnsignedWebhooks` is set.
   */
  appSecret?: string
  /** Explicit local-development escape hatch for unsigned webhook POSTs. */
  allowUnsignedWebhooks?: boolean
  /**
   * Time allowed for each Send API request (send, typing, mark seen), in ms. A request
   * that takes longer rejects with a `ProviderError` ("timed out"). Default 60 000 —
   * the same as `@botmesh/meta`. Media downloads keep `mediaDownload.timeoutMs`.
   */
  requestTimeoutMs?: number
  /** Graph API version, e.g. `'v26.0'`. Default: `DEFAULT_GRAPH_API_VERSION` from `@botmesh/graph-core` (the current version, `'v26.0'`). */
  apiVersion?: string
  /** Graph base URL. Default 'https://graph.facebook.com'. */
  graphUrl?: string
  /** Safe-download policy for inbound media. HTTPS/public hosts are enforced by default. */
  mediaDownload?: Omit<SecureFetchOptions, 'fetch'>
  /**
   * Durable inbox (`BotConfig.durability`): hosts whose attachment URLs are journaled so a
   * replayed message can download its media again. A name also allows its subdomains.
   * Default: the Meta attachment CDNs (`META_MEDIA_HOSTS` of `@botmesh/graph-core`). Plain
   * `http:` URLs are only accepted with `mediaDownload.allowHttp`.
   */
  mediaRefHosts?: string[]
  /** The Page id: a message whose sender is this id is marked `fromMe` (the bot's `selfId`). Optional. */
  selfId?: string
  /** Page id (or 'me') that owns the Send API endpoint. Default 'me'. */
  pageId?: string
  /**
   * @deprecated Pass a `logger` (any `LoggerLike`, e.g. `pino({ level: 'debug' })`)
   * instead. Removal planned for v3.
   */
  debug?: boolean
  /** Logger for provider diagnostics (any `LoggerLike`: pino, console…). Default: pino at `error`. */
  logger?: LoggerLike
}

/* --- Graph API request/response shapes (subset used) --------------------- */

/** Success shape of POST /{page-id}/messages. */
export interface MessengerSendResponse {
  recipient_id?: string
  message_id?: string
  error?: {
    type?: string
    code?: number
    message?: string
    error_subcode?: number
    fbtrace_id?: string
  }
}
