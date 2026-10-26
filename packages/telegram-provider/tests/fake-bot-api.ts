/**
 * A small in-process fake of the Telegram Bot API over real HTTP (127.0.0.1),
 * so end-to-end tests exercise the provider's real fetch / multipart / long-poll
 * / secureFetch paths without network access or credentials.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface RecordedCall { method: string; params: Record<string, unknown>; multipart: boolean }

type Override = (params: Record<string, unknown>) => { status: number; body: unknown } | undefined

export class FakeBotApi {
  readonly calls: RecordedCall[] = []
  readonly files = new Map<string, Buffer>()
  private server?: Server
  private nextUpdateId = 1
  private nextMessageId = 1000
  private queue: unknown[] = []
  private waiters: Array<() => void> = []
  private overrides = new Map<string, Override[]>()
  private sockets = new Set<import('node:net').Socket>()
  baseUrl = ''

  constructor(readonly token = '42:FAKE-token') {}

  async start(): Promise<this> {
    this.server = createServer((req, res) => { void this.handle(req, res) })
    this.server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)) })
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()))
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`
    return this
  }

  async close(): Promise<void> {
    for (const w of this.waiters.splice(0)) w()
    for (const s of this.sockets) s.destroy()
    await new Promise<void>((r) => this.server?.close(() => r()) ?? r())
  }

  /** Answer the next call(s) of `method` with a custom envelope (used once each). */
  failNext(method: string, status: number, body: unknown): void {
    const list = this.overrides.get(method) ?? []
    list.push(() => ({ status, body }))
    this.overrides.set(method, list)
  }

  /** Queue an Update for getUpdates (update_id assigned here). Returns it. */
  push(update: Record<string, unknown>): Record<string, unknown> {
    const u = { update_id: this.nextUpdateId++, ...update }
    this.queue.push(u)
    for (const w of this.waiters.splice(0)) w()
    return u
  }

  /** Convenience: a private-chat text message from user `uid`. */
  text(uid: number, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const message = { message_id: this.nextMessageId++, date: 1_700_000_000, chat: { id: uid, type: 'private', first_name: `U${uid}` }, from: { id: uid, first_name: `U${uid}`, language_code: 'es' }, text, ...extra }
    return this.push({ message })
  }

  sent(method: string): RecordedCall[] { return this.calls.filter((c) => c.method === method) }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const send = (status: number, body: unknown): void => {
      if (res.writableEnded) return
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    const fileMatch = url.match(/^\/file\/bot([^/]+)\/(.+)$/)
    if (fileMatch) {
      const bytes = fileMatch[1] === this.token ? this.files.get(fileMatch[2]) : undefined
      if (!bytes) { res.statusCode = 404; res.end('not found'); return }
      res.statusCode = 200
      res.end(bytes)
      return
    }
    const m = url.match(/^\/bot([^/]+)\/(\w+)$/)
    if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' })
    if (m[1] !== this.token) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    const method = m[2]
    const ct = req.headers['content-type'] ?? ''
    let params: Record<string, unknown> = {}
    const multipart = ct.startsWith('multipart/form-data')
    if (multipart) {
      const form = await new Response(raw, { headers: { 'content-type': ct } }).formData()
      for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : { upload: (v as File).name, size: (v as File).size }
    } else if (raw.length) {
      params = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    }
    this.calls.push({ method, params, multipart })
    const override = this.overrides.get(method)?.shift()
    const forced = override?.(params)
    if (forced) return send(forced.status, forced.body)

    switch (method) {
      case 'getMe': return send(200, { ok: true, result: { id: 4242, is_bot: true, first_name: 'Fake', username: 'fake_bot' } })
      case 'getUpdates': {
        const offset = typeof params.offset === 'number' ? params.offset : 0
        this.queue = this.queue.filter((u) => (u as { update_id: number }).update_id >= offset)
        const timeout = typeof params.timeout === 'number' ? params.timeout : 0
        if (!this.queue.length && timeout > 0) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, timeout * 1000)
            this.waiters.push(() => { clearTimeout(t); resolve() })
            req.on('close', () => { clearTimeout(t); resolve() })
          })
        }
        const batch = this.queue.filter((u) => (u as { update_id: number }).update_id >= offset).slice(0, 100)
        return send(200, { ok: true, result: batch })
      }
      case 'getFile': {
        const id = String(params.file_id)
        return this.files.has(id) ? send(200, { ok: true, result: { file_id: id, file_path: id } }) : send(400, { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' })
      }
      case 'sendChatAction': case 'answerCallbackQuery': case 'setMessageReaction': case 'deleteMessage': case 'sendMessageDraft':
        return send(200, { ok: true, result: true })
      case 'editMessageText':
        if (params.inline_message_id) return send(200, { ok: true, result: true })
        return send(200, { ok: true, result: { message_id: Number(params.message_id), chat: { id: Number(params.chat_id) }, text: params.text } })
      default: {
        if (!method.startsWith('send')) return send(400, { ok: false, error_code: 400, description: `Bad Request: unknown method ${method}` })
        const chatId = Number(params.chat_id)
        if (!Number.isFinite(chatId)) return send(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })
        if (typeof params.text === 'string' && params.text.length > 4096) return send(400, { ok: false, error_code: 400, description: 'Bad Request: message is too long' })
        return send(200, { ok: true, result: { message_id: this.nextMessageId++, date: 1_700_000_000, chat: { id: chatId, type: 'private' } } })
      }
    }
  }
}
