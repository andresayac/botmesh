/**
 * In-memory fake of the parts of the Chatwoot Application API the plugin uses.
 * Plugged in through the injected `fetch` (no network): every request is recorded.
 */

export interface RecordedRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: unknown
}

interface FakeConversation { id: number; contactId: number; status: string; labels: string[]; messages: FakeMessage[] }
interface FakeMessage { id: number; content: string; message_type: string; private: boolean; status?: string; external_error?: string }

export class FakeChatwoot {
  requests: RecordedRequest[] = []
  contacts: Array<{ id: number; name: string; identifier?: string; source_id: string; last_activity_at?: number; /** Inboxes the contact is linked to (default [2]). */ inboxes?: number[] }> = []
  /** Conversation ids Chatwoot is still deleting: messages answer 422, the conversation itself 404. */
  deleting = new Set<number>()
  /**
   * What GET /conversations/:id answers for a conversation in `deleting`. Real Chatwoot 4.7
   * answers 404 or, while the contact is already nil, often 500.
   */
  deletingProbeStatus = 404
  conversations = new Map<number, FakeConversation>()
  /** Next responses forced to an HTTP status (by method+path regex). */
  failures: Array<{ match: RegExp; status: number; times: number }> = []
  /** Hook called right before a message creation responds (to simulate webhook races). */
  onMessageCreated?: (conversationId: number, message: FakeMessage) => void
  /** Message status updates (PATCH …/messages/:id). */
  patchedStatuses: Array<{ conversationId: number; messageId: number; status: string; external_error?: string }> = []
  private seq = 100

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => { headers[k] = v })
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    this.requests.push({ method, path: url.pathname, query: url.searchParams, headers, body })

    const key = `${method} ${url.pathname}`
    const failure = this.failures.find((f) => f.match.test(key) && f.times > 0)
    if (failure) {
      failure.times -= 1
      return json({ error: 'forced' }, failure.status)
    }
    if (headers['api_access_token'] !== 'secret-key') return json({ error: 'unauthorized' }, 401)
    return this.route(method, url, body)
  }

  private route(method: string, url: URL, body: any): Response {
    const p = url.pathname.replace(/^\/api\/v1\/accounts\/1/, '')
    let m: RegExpExecArray | null
    if (method === 'GET' && p === '/contacts/search') {
      // Like Chatwoot: substring match (LIKE %q%), contacts with activity first, 15 per page.
      const q = url.searchParams.get('q') ?? ''
      const hits = this.contacts
        .filter((c) => (c.identifier ?? '').includes(q) || c.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0))
        .slice(0, 15)
      return json({ payload: hits.map((c) => ({ id: c.id, name: c.name, identifier: c.identifier })) })
    }
    if (method === 'POST' && p === '/contacts/filter') {
      const rule = body?.payload?.[0]
      if (rule?.attribute_key !== 'identifier' || rule?.filter_operator !== 'equal_to') return json({ error: 'unsupported filter' }, 422)
      const wanted = (rule.values as string[]).map((v) => v.toLowerCase())
      const hits = this.contacts.filter((c) => c.identifier !== undefined && wanted.includes(c.identifier.toLowerCase()))
      return json({
        meta: { count: hits.length },
        payload: hits.map((c) => ({ id: c.id, name: c.name, identifier: c.identifier, contact_inboxes: (c.inboxes ?? [2]).map((id) => ({ source_id: c.source_id, inbox: { id } })) })),
      })
    }
    if (method === 'GET' && (m = /^\/contacts\/(\d+)\/conversations$/.exec(p))) {
      const contactId = Number(m[1])
      if (!this.contacts.some((c) => c.id === contactId)) return json({ error: 'not found' }, 404)
      const convs = [...this.conversations.values()].filter((c) => c.contactId === contactId).reverse()
      return json({ payload: convs.map((c) => ({ id: c.id, inbox_id: 2, status: c.status })) })
    }
    if (method === 'GET' && (m = /^\/conversations\/(\d+)$/.exec(p))) {
      const conv = this.conversations.get(Number(m[1]))
      if (!conv) return json({ error: 'not found' }, 404)
      if (this.deleting.has(conv.id)) {
        return this.deletingProbeStatus === 404 ? json({ error: 'not found' }, 404) : json({ error: 'Internal Server Error' }, this.deletingProbeStatus)
      }
      return json({ id: conv.id, status: conv.status, inbox_id: 2 })
    }
    if (method === 'PATCH' && (m = /^\/conversations\/(\d+)\/messages\/(\d+)$/.exec(p))) {
      const msg = this.conversations.get(Number(m[1]))?.messages.find((x) => x.id === Number(m![2]))
      if (msg) { msg.status = body.status; msg.external_error = body.external_error }
      this.patchedStatuses.push({ conversationId: Number(m[1]), messageId: Number(m[2]), status: body.status, external_error: body.external_error })
      return json({ id: Number(m[2]), status: body.status })
    }
    if (method === 'POST' && p === '/contacts') {
      const c = { id: ++this.seq, name: body.name, identifier: body.identifier, source_id: `src-${this.seq}` }
      this.contacts.push(c)
      return json({ payload: { contact: { id: c.id, name: c.name, identifier: c.identifier }, contact_inbox: { source_id: c.source_id } } })
    }
    if (method === 'POST' && (m = /^\/contacts\/(\d+)\/contact_inboxes$/.exec(p))) {
      if (!this.contacts.some((c) => c.id === Number(m![1]))) return json({ error: 'not found' }, 404)
      return json({ source_id: `ci-${m[1]}` })
    }
    if (method === 'POST' && p === '/conversations') {
      if (!this.contacts.some((c) => c.id === body.contact_id)) return json({ error: 'not found' }, 404)
      const id = ++this.seq
      this.conversations.set(id, { id, contactId: body.contact_id, status: body.status ?? 'open', labels: [], messages: [] })
      return json({ id, status: 'open' })
    }
    if ((m = /^\/conversations\/(\d+)\/messages$/.exec(p)) && method === 'POST') {
      const conv = this.conversations.get(Number(m[1]))
      if (!conv) return json({ error: 'not found' }, 404)
      if (this.deleting.has(conv.id)) return json({ error: "undefined method 'blocked?' for nil" }, 422)
      const msg = { id: ++this.seq, content: body.content, message_type: body.message_type, private: body.private ?? false }
      conv.messages.push(msg)
      this.onMessageCreated?.(conv.id, msg)
      return json({ id: msg.id, content: msg.content })
    }
    if ((m = /^\/conversations\/(\d+)\/toggle_status$/.exec(p)) && method === 'POST') {
      const conv = this.conversations.get(Number(m[1]))
      if (!conv) return json({ error: 'not found' }, 404)
      conv.status = body.status
      return json({ payload: { success: true, current_status: conv.status } })
    }
    if ((m = /^\/conversations\/(\d+)\/labels$/.exec(p))) {
      const conv = this.conversations.get(Number(m[1]))
      if (!conv) return json({ error: 'not found' }, 404)
      if (method === 'POST') conv.labels = [...body.labels]
      return json({ payload: conv.labels })
    }
    return json({ error: `no route ${method} ${p}` }, 404)
  }

  /** Delete a contact and its conversations (what Chatwoot does). */
  deleteContact(contactId: number): void {
    this.contacts = this.contacts.filter((c) => c.id !== contactId)
    for (const [id, conv] of this.conversations) if (conv.contactId === contactId) this.conversations.delete(id)
  }

  messagesOf(conversationId: number): FakeMessage[] {
    return this.conversations.get(conversationId)?.messages ?? []
  }

  onlyConversation(): FakeConversation {
    const all = [...this.conversations.values()]
    if (all.length !== 1) throw new Error(`expected 1 conversation, got ${all.length}`)
    return all[0]
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

/** Resolver that never touches DNS (public address so secureFetch's SSRF guard passes). */
export const publicResolver = async (): Promise<string[]> => ['93.184.216.34']
