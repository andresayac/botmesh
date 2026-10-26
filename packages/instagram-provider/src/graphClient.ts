/**
 * graphClient — thin fetch wrapper over the Messenger API for Instagram (Graph).
 * Node 20 global fetch; zero runtime dependencies. Maps Graph errors to the
 * core's typed provider errors (code 4 / 613 → RateLimitedError).
 */

import { ProviderError, type ChatId, type OutboundContent } from '@botmesh/core'
import { toGraphError, readGraphResponse, type GraphError } from '@botmesh/graph-core'
import { secureFetch, type SecureFetchOptions } from '@botmesh/http'

export interface GraphClientConfig {
  accessToken: string
  apiVersion: string
  graphUrl: string
  mediaDownload?: Omit<SecureFetchOptions, 'fetch'>
  /** Timeout of each Send API request, in ms. Default 60000. */
  timeoutMs?: number
}

/**
 * Translate a Graph error into a typed provider error. Thin wrapper over the
 * shared {@link toGraphError} of `@botmesh/graph-core`, the single source of the
 * Messenger Platform window/recipient codes. `chatId` (the IGSID the call
 * targeted) is carried on window/unreachable errors.
 */
export function toProviderError(err: GraphError, retryAfterMs?: number, chatId: ChatId = ''): ProviderError {
  return toGraphError(err, { retryAfterMs, chatId })
}

export class GraphClient {
  constructor(private cfg: GraphClientConfig) {}

  private base(path: string): string {
    return `${this.cfg.graphUrl.replace(/\/$/, '')}/${this.cfg.apiVersion}/${path}`
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' }
  }

  /**
   * Send a message payload (already shaped by toOutbound) to `me/messages`.
   * `contentKind` is reported on a typed `UnsupportedContentError`.
   */
  async sendMessage(
    recipientId: string,
    message: Record<string, unknown>,
    contentKind?: OutboundContent['kind'],
  ): Promise<{ message_id?: string; recipient_id?: string }> {
    return timedCall(this.base('me/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ recipient: { id: recipientId }, message }),
    }, this.cfg.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    (res) => readGraphResponse<{ message_id?: string; recipient_id?: string }>(res, { chatId: recipientId, contentKind }))
  }

  /** Send a sender_action: 'mark_seen' | 'typing_on' | 'typing_off'. */
  async sendSenderAction(recipientId: string, senderAction: 'mark_seen' | 'typing_on' | 'typing_off'): Promise<void> {
    await timedCall(this.base('me/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ recipient: { id: recipientId }, sender_action: senderAction }),
    }, this.cfg.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    (res) => readGraphResponse(res, { chatId: recipientId }))
  }

  /** Download media bytes from a hosted URL (attachment payload.url). */
  async downloadUrl(url: string): Promise<Buffer> {
    const { response: res, body } = await secureFetch(url, this.cfg.mediaDownload)
    if (!res.ok) throw new ProviderError(`Media download failed: HTTP ${res.status}`)
    return body
  }
}

/**
 * `fetch` + `read(response)` under one `timeoutMs` deadline (the body is read before the
 * timer is cleared, so a body that never ends times out too). A timeout or transport
 * failure rejects with a typed `ProviderError` that never carries the URL or the access
 * token; a typed error from `read` (a Graph error) passes through.
 */
async function timedCall<T>(url: string, init: RequestInit, timeoutMs: number, read: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return await read(res)
  } catch (err) {
    if (err instanceof ProviderError && !controller.signal.aborted) throw err
    const wrapped = new ProviderError(controller.signal.aborted
      ? `Instagram Send API request timed out after ${timeoutMs}ms`
      : `Instagram Send API request failed: ${err instanceof Error ? err.name : 'network error'}`)
    ;(wrapped as { cause?: unknown }).cause = err
    throw wrapped
  } finally {
    clearTimeout(timer)
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/** Throw on a `requestTimeoutMs` that cannot work. */
export function assertTimeout(provider: string, value: unknown): void {
  if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 2 ** 31 - 1)) {
    throw new TypeError(`${provider}: requestTimeoutMs must be a positive number of milliseconds`)
  }
}
