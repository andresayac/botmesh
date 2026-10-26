/**
 * graphClient — thin fetch wrapper over the WhatsApp Cloud API (Graph).
 * Node's global fetch, with a per-request timeout. Maps Graph errors to the
 * core's typed provider errors.
 */

import { PayloadTooLargeError, ProviderError, type ChatId, type OutboundContent } from '@botmesh/core'
import { toGraphError, readGraphResponse, type GraphError, type GraphErrorOptions } from '@botmesh/graph-core'
import { SecureHttpError, secureFetch, type SecureFetchOptions, type SecureFetchResponse } from '@botmesh/http'
import { isBsuid } from './identity.js'

export interface GraphClientConfig {
  accessToken: string
  phoneNumberId: string
  apiVersion: string
  graphUrl: string
  mediaDownload?: Omit<SecureFetchOptions, 'fetch'>
  /** Time allowed for each Graph API request, in ms. Default {@link DEFAULT_GRAPH_TIMEOUT_MS}. */
  timeoutMs?: number
}

/** Default time allowed for one Graph API request (uploads included). */
export const DEFAULT_GRAPH_TIMEOUT_MS = 60_000

/**
 * Translate a Graph error into a typed provider error. Thin wrapper over the
 * shared {@link toGraphError} (kept for API compatibility + the chatId-first
 * signature callers expect).
 */
export function toProviderError(chatId: ChatId, err: GraphError, retryAfterMs?: number): ProviderError {
  return toGraphError(err, { chatId, retryAfterMs })
}

/** Wrap a Graph transport failure in a typed {@link ProviderError} (original as `cause`). */
function transportError(err: unknown, timeoutMs: number, timedOut: boolean): ProviderError {
  const wrapped = new ProviderError(timedOut
    ? `Graph API request timed out after ${timeoutMs}ms`
    : `Graph API request failed: ${err instanceof Error ? err.message : String(err)}`)
  ;(wrapped as { cause?: unknown }).cause = err
  return wrapped
}

/**
 * `secureFetch` for the media CDN step: policy refusals (SSRF, redirects),
 * timeouts and transport failures reject with a typed {@link ProviderError}
 * (original as `cause`); an oversized body becomes a {@link PayloadTooLargeError}.
 * The message never includes the URL's query (signed media URLs carry tokens).
 */
async function secureFetchTyped(url: string, init: SecureFetchOptions): Promise<SecureFetchResponse> {
  try {
    return await secureFetch(url, init)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const wrapped = err instanceof SecureHttpError && err.code === 'RESPONSE_TOO_LARGE'
      ? new PayloadTooLargeError(`Media download too large: ${detail}`)
      : new ProviderError(`Media download failed: ${detail}`)
    ;(wrapped as { cause?: unknown }).cause = err
    throw wrapped
  }
}

export class GraphClient {
  private readonly timeoutMs: number

  constructor(private cfg: GraphClientConfig) {
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_GRAPH_TIMEOUT_MS
  }

  /**
   * One Graph request: fetch + {@link readGraphResponse}, both under the
   * request timeout (a body that never finishes times out too). Transport
   * failures reject with a typed {@link ProviderError} whose message never
   * includes the URL or the token; the timer is cleared as soon as it settles.
   */
  private async call(path: string, init: RequestInit, opts: GraphErrorOptions = {}): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    timer.unref?.()
    try {
      let res: Response
      try {
        res = await fetch(this.base(path), { ...init, signal: controller.signal })
      } catch (err) {
        throw transportError(err, this.timeoutMs, controller.signal.aborted)
      }
      let body: unknown
      try {
        body = await readGraphResponse(res, opts)
      } catch (err) {
        if (controller.signal.aborted && !(err instanceof ProviderError)) throw transportError(err, this.timeoutMs, true)
        throw err
      }
      // readGraphResponse reads an unreadable body as `{}`: an abort mid-body must not pass as success.
      if (controller.signal.aborted) throw transportError(controller.signal.reason, this.timeoutMs, true)
      return body
    } finally {
      clearTimeout(timer)
    }
  }

  private base(path: string): string {
    return `${this.cfg.graphUrl.replace(/\/$/, '')}/${this.cfg.apiVersion}/${path}`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.accessToken}`, ...extra }
  }

  /**
   * Send a message payload (already shaped by toOutbound). A business-scoped
   * user id (BSUID, e.g. `US.1349...`, or a parent `US.ENT.1181...`) is
   * addressed with `recipient`; a phone number (wa_id) with `to`. Never both:
   * Meta gives `to` precedence when both are present. `contentKind` (the
   * `OutboundContent` kind being sent) is reported on the typed
   * `UnsupportedContentError` of codes 131051 / 131062.
   */
  async sendMessage(to: ChatId, message: Record<string, unknown>, contentKind?: OutboundContent['kind']): Promise<{ id?: string }> {
    const target = isBsuid(to) ? { recipient: to } : { to }
    const body = (await this.call(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...target, ...message }),
    }, { chatId: to, contentKind })) as { messages?: Array<{ id: string }> }
    return { id: body.messages?.[0]?.id }
  }

  /**
   * POST a JSON body to a Graph path (relative to the API version), e.g.
   * `{WABA-ID}/flows`. Graph errors map to typed provider errors.
   */
  async postJson<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    return (await this.call(path, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })) as T
  }

  /** Mark an inbound message as read. */
  async markRead(messageId: string): Promise<void> {
    await this.call(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    })
  }

  /** Upload media (multipart) → media id. */
  async uploadMedia(buffer: Buffer, mimetype: string, filename?: string): Promise<string> {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', mimetype)
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), filename ?? 'file')
    const body = (await this.call(`${this.cfg.phoneNumberId}/media`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    })) as { id?: string }
    if (!body.id) throw new ProviderError('Media upload returned no id')
    return body.id
  }

  /** Download media bytes by media id (two-step: resolve URL, then fetch it). */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimetype: string }> {
    // The id is untrusted (webhook / journal): encode it so it stays one path segment.
    const info = (await this.call(encodeURIComponent(mediaId), { headers: this.headers() })) as { url?: string; mime_type?: string }
    if (!info.url) throw new ProviderError('Media metadata returned no url')
    const { response: file, body } = await secureFetchTyped(info.url, { ...this.cfg.mediaDownload, headers: this.headers() })
    if (!file.ok) throw new ProviderError(`Media download failed: HTTP ${file.status}`)
    return { buffer: body, mimetype: info.mime_type ?? 'application/octet-stream' }
  }
}
