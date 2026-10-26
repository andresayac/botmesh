/**
 * Minimal Chatwoot Application API client (`/api/v1/accounts/{accountId}/…`).
 *
 * Every request goes through `secureFetch` from `@botmesh/http` (HTTPS only, SSRF guard on
 * the resolved address, timeout, size limit) and never follows redirects, so the
 * `api_access_token` header can never be forwarded to another origin. Self-hosted
 * Chatwoot on a private network needs `http.allowPrivateHosts` (and `http.allowHttp`
 * for plain HTTP) explicitly.
 */

import { SecureHttpError, secureFetch, type HostResolver } from '@botmesh/http'

/** Transport knobs for the Chatwoot client (all optional). */
export interface ChatwootHttpOptions {
  /** Inject a fetch implementation (tests, custom dispatchers). */
  fetch?: typeof globalThis.fetch
  /** Override DNS resolution (tests, controlled egress). */
  resolver?: HostResolver
  /** Allow `http://` base URLs. Default `false`. */
  allowHttp?: boolean
  /** Allow loopback/private destinations (self-hosted Chatwoot on a LAN). Default `false`. */
  allowPrivateHosts?: boolean
  /** Per-request timeout in ms. Default `15000`. */
  timeoutMs?: number
}

export interface ChatwootClientOptions {
  baseUrl: string
  apiKey: string
  accountId: number | string
  http?: ChatwootHttpOptions
}

/** A non-2xx answer from the Chatwoot API. */
export class ChatwootApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`Chatwoot API ${method} ${path} failed: HTTP ${status}`)
    this.name = 'ChatwootApiError'
  }
}

/** `message_type` values accepted by the messages endpoint. */
export type ChatwootMessageType = 'incoming' | 'outgoing'

/** Conversation status values. */
export type ChatwootConversationStatus = 'open' | 'resolved' | 'pending' | 'snoozed'

export interface ChatwootContactInput {
  inboxId: number
  name?: string
  identifier?: string
  phoneNumber?: string
  email?: string
  customAttributes?: Record<string, unknown>
}

/** Delivery status of a message (`PATCH …/messages/:id`, API-channel inboxes). */
export type ChatwootMessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

/** A conversation as the client reports it. */
export interface ChatwootConversationRef {
  id: number
  inboxId?: number
  status?: ChatwootConversationStatus
}

export interface ChatwootContactRef {
  id: number
  /** Contact-inbox source id, when Chatwoot returned one. */
  sourceId?: string
}

type Json = Record<string, unknown>

function asObject(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}
function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

export function normalizeBaseUrl(baseUrl: string): string {
  let url: URL
  try { url = new URL(baseUrl) } catch { throw new Error(`Invalid chatwoot config.baseUrl: ${JSON.stringify(baseUrl)}`) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Invalid chatwoot config.baseUrl: unsupported protocol ${url.protocol}`)
  return url.href.replace(/\/+$/, '')
}

export class ChatwootClient {
  private readonly base: string

  constructor(private readonly opts: ChatwootClientOptions) {
    const base = normalizeBaseUrl(opts.baseUrl)
    if (base.startsWith('http:') && opts.http?.allowHttp !== true) {
      throw new Error(`Invalid chatwoot config.baseUrl: ${base} uses plain http://; use https://, or set http.allowHttp: true (plus http.allowPrivateHosts: true for a Chatwoot on localhost or a LAN)`)
    }
    this.base = `${base}/api/v1/accounts/${encodeURIComponent(String(opts.accountId))}`
  }

  /** Low-level request. Resolves the parsed JSON body (or `undefined` for an empty one). */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const http = this.opts.http ?? {}
    // The query string can carry a chat id (contact search): keep it out of errors and logs.
    const bare = path.split('?')[0]!
    let result: Awaited<ReturnType<typeof secureFetch>>
    try {
      result = await secureFetch(`${this.base}${path}`, {
        method,
        headers: {
          api_access_token: this.opts.apiKey,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        maxRedirects: 0,
        maxBytes: 2 * 1024 * 1024,
        timeoutMs: http.timeoutMs ?? 15_000,
        allowHttp: http.allowHttp ?? false,
        allowPrivateHosts: http.allowPrivateHosts ?? false,
        ...(http.fetch ? { fetch: http.fetch } : {}),
        ...(http.resolver ? { resolver: http.resolver } : {}),
      })
    } catch (error) {
      if (error instanceof SecureHttpError && (error.code === 'UNSAFE_HOST' || error.code === 'UNSAFE_URL')) {
        throw new SecureHttpError(
          `Chatwoot ${method} ${bare}: ${error.message}. A self-hosted Chatwoot on localhost or a private network needs http.allowPrivateHosts: true (and http.allowHttp: true for http://)`,
          error.code,
        )
      }
      throw error
    }
    const { response, body: raw } = result
    const text = raw.toString('utf8')
    if (!response.ok) throw new ChatwootApiError(response.status, method, bare, text.slice(0, 500))
    if (text.trim() === '') return undefined
    try { return JSON.parse(text) } catch { return text }
  }

  /**
   * Find the contact whose `identifier` equals `identifier` exactly, through the contacts
   * filter API (`identifier equal_to`). With `inboxId`, `sourceId` is the contact's
   * existing contact-inbox in that inbox, when there is one. Falls back to the
   * substring search (first page only) on a Chatwoot without the filter endpoint.
   */
  async findContactByIdentifier(identifier: string, inboxId?: number): Promise<ChatwootContactRef | undefined> {
    let list: unknown[]
    try {
      const res = asObject(await this.request('POST', '/contacts/filter', {
        payload: [{ attribute_key: 'identifier', filter_operator: 'equal_to', values: [identifier], query_operator: null }],
      }))
      list = Array.isArray(res.payload) ? res.payload : []
    } catch (error) {
      if (!(error instanceof ChatwootApiError) || error.status !== 404) throw error
      const res = asObject(await this.request('GET', `/contacts/search?q=${encodeURIComponent(identifier)}`))
      list = Array.isArray(res.payload) ? res.payload : []
    }
    for (const item of list) {
      const c = asObject(item)
      const id = asNumber(c.id)
      if (id === undefined || c.identifier !== identifier) continue
      if (inboxId !== undefined && Array.isArray(c.contact_inboxes)) {
        for (const ci of c.contact_inboxes) {
          const link = asObject(ci)
          const linked = asNumber(asObject(link.inbox).id) ?? asNumber(link.inbox_id)
          if (linked === inboxId && typeof link.source_id === 'string') return { id, sourceId: link.source_id }
        }
      }
      return { id }
    }
    return undefined
  }

  /** The contact's conversations (newest first as Chatwoot lists them), with their inbox and status. */
  async listContactConversations(contactId: number): Promise<ChatwootConversationRef[]> {
    const res = asObject(await this.request('GET', `/contacts/${contactId}/conversations`))
    const list = Array.isArray(res.payload) ? res.payload : []
    const out: ChatwootConversationRef[] = []
    for (const item of list) {
      const c = asObject(item)
      const id = asNumber(c.id)
      if (id === undefined) continue
      const inboxId = asNumber(c.inbox_id) ?? asNumber(asObject(c.inbox).id)
      out.push({ id, ...(inboxId !== undefined ? { inboxId } : {}), ...(typeof c.status === 'string' ? { status: c.status as ChatwootConversationStatus } : {}) })
    }
    return out
  }

  /** One conversation; rejects with a 404 `ChatwootApiError` when it does not exist. */
  async getConversation(conversationId: number): Promise<ChatwootConversationRef> {
    const c = asObject(await this.request('GET', `/conversations/${conversationId}`))
    const inboxId = asNumber(c.inbox_id) ?? asNumber(asObject(c.inbox).id)
    return { id: asNumber(c.id) ?? conversationId, ...(inboxId !== undefined ? { inboxId } : {}), ...(typeof c.status === 'string' ? { status: c.status as ChatwootConversationStatus } : {}) }
  }

  /**
   * Set a message's delivery status (API-channel inboxes only). `externalError` is shown
   * to the agent next to a `failed` message.
   */
  async updateMessageStatus(conversationId: number, messageId: number, status: ChatwootMessageStatus, externalError?: string): Promise<void> {
    await this.request('PATCH', `/conversations/${conversationId}/messages/${messageId}`, {
      status,
      ...(externalError !== undefined ? { external_error: externalError } : {}),
    })
  }

  async createContact(input: ChatwootContactInput): Promise<ChatwootContactRef> {
    const res = asObject(await this.request('POST', '/contacts', {
      inbox_id: input.inboxId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.identifier !== undefined ? { identifier: input.identifier } : {}),
      ...(input.phoneNumber !== undefined ? { phone_number: input.phoneNumber } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.customAttributes !== undefined ? { custom_attributes: input.customAttributes } : {}),
    }))
    // Chatwoot versions differ: { payload: { contact, contact_inbox } } | { payload: contact } | contact
    const payload = asObject(res.payload ?? res)
    const contact = asObject(payload.contact ?? payload)
    const id = asNumber(contact.id)
    if (id === undefined) throw new Error('Chatwoot createContact: response has no contact id')
    const inbox = asObject(payload.contact_inbox)
    const sourceId = typeof inbox.source_id === 'string' ? inbox.source_id : undefined
    return sourceId !== undefined ? { id, sourceId } : { id }
  }

  /** Link a contact to an inbox; resolves the contact-inbox `source_id`. */
  async createContactInbox(contactId: number, inboxId: number): Promise<string | undefined> {
    const res = asObject(await this.request('POST', `/contacts/${contactId}/contact_inboxes`, { inbox_id: inboxId }))
    const src = res.source_id ?? asObject(res.payload).source_id
    return typeof src === 'string' ? src : undefined
  }

  async createConversation(input: { inboxId: number; contactId: number; sourceId?: string; status?: ChatwootConversationStatus }): Promise<number> {
    const res = asObject(await this.request('POST', '/conversations', {
      inbox_id: input.inboxId,
      contact_id: input.contactId,
      ...(input.sourceId !== undefined ? { source_id: input.sourceId } : {}),
      status: input.status ?? 'open',
    }))
    const id = asNumber(res.id) ?? asNumber(asObject(res.payload).id)
    if (id === undefined) throw new Error('Chatwoot createConversation: response has no conversation id')
    return id
  }

  /** Post a message; resolves the Chatwoot message id (when returned). */
  async createMessage(conversationId: number, input: { content: string; messageType: ChatwootMessageType; private?: boolean }): Promise<number | undefined> {
    const res = asObject(await this.request('POST', `/conversations/${conversationId}/messages`, {
      content: input.content,
      message_type: input.messageType,
      private: input.private ?? false,
    }))
    return asNumber(res.id)
  }

  async toggleStatus(conversationId: number, status: ChatwootConversationStatus): Promise<void> {
    await this.request('POST', `/conversations/${conversationId}/toggle_status`, { status })
  }

  async getLabels(conversationId: number): Promise<string[]> {
    const res = asObject(await this.request('GET', `/conversations/${conversationId}/labels`))
    return Array.isArray(res.payload) ? res.payload.filter((l): l is string => typeof l === 'string') : []
  }

  /** Replace the conversation's labels (Chatwoot semantics). */
  async setLabels(conversationId: number, labels: string[]): Promise<void> {
    await this.request('POST', `/conversations/${conversationId}/labels`, { labels })
  }
}
