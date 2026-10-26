/**
 * graphClient — thin fetch wrapper over the Messenger API for Instagram (Graph).
 * Node global fetch with a per-request timeout (`graphRequest` of graph-core). Maps Graph errors to the
 * core's typed provider errors (code 4 / 613 → RateLimitedError).
 */

import { ProviderError, type ChatId, type OutboundContent } from '@botmesh/core'
import { toGraphError, graphRequest, type GraphError } from '@botmesh/graph-core'
import { secureFetch, type SecureFetchOptions } from '@botmesh/http'

export interface GraphClientConfig {
  accessToken: string
  apiVersion: string
  graphUrl: string
  mediaDownload?: Omit<SecureFetchOptions, 'fetch'>
  /** Time allowed for each Send API request, in ms. Default 60 000 (`DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`). */
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

  private timeout(): { timeoutMs?: number } {
    return this.cfg.timeoutMs !== undefined ? { timeoutMs: this.cfg.timeoutMs } : {}
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
    return graphRequest<{ message_id?: string; recipient_id?: string }>(this.base('me/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ recipient: { id: recipientId }, message }),
    }, { chatId: recipientId, ...(contentKind !== undefined ? { contentKind } : {}), ...this.timeout() })
  }

  /** Send a sender_action: 'mark_seen' | 'typing_on' | 'typing_off'. */
  async sendSenderAction(recipientId: string, senderAction: 'mark_seen' | 'typing_on' | 'typing_off'): Promise<void> {
    await graphRequest(this.base('me/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ recipient: { id: recipientId }, sender_action: senderAction }),
    }, { chatId: recipientId, ...this.timeout() })
  }

  /** Download media bytes from a hosted URL (attachment payload.url). */
  async downloadUrl(url: string): Promise<Buffer> {
    const { response: res, body } = await secureFetch(url, this.cfg.mediaDownload)
    if (!res.ok) throw new ProviderError(`Media download failed: HTTP ${res.status}`)
    return body
  }
}
