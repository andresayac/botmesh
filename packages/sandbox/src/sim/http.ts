/**
 * Minimal HTTP plumbing for the simulators: a path router with `:params`, a
 * request wrapper that keeps the raw body (signatures and spec checks need the
 * exact bytes) and a `listen()` helper bound to 127.0.0.1. node:http only.
 */

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A request as a simulator handler sees it. */
export interface SimRequest {
  method: string
  /** Path without the query string, percent-decoded per segment by the router. */
  path: string
  query: URLSearchParams
  headers: IncomingHttpHeaders
  /** Raw body bytes. */
  body: Buffer
  /** `:name` captures of the matched route. */
  params: Record<string, string>
  /** Body parsed as JSON, or `undefined` when it is not JSON. */
  json(): unknown
  /** Body parsed as `application/x-www-form-urlencoded`. */
  form(): URLSearchParams
  /** Body parsed as `multipart/form-data` (WHATWG FormData). */
  multipart(): Promise<FormData>
  /** Lower-cased header value (first one when repeated). */
  header(name: string): string | undefined
}

/** A handler's answer. Objects become JSON; strings and Buffers are sent as-is. */
export interface SimResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export type SimHandler = (req: SimRequest) => SimResponse | Promise<SimResponse>

interface Route {
  method: string
  segments: string[]
  handler: SimHandler
}

/** Ordered route table. `*` matches the rest of the path (captured as `params['*']`). */
export class Router {
  private readonly routes: Route[] = []

  add(method: string, pattern: string, handler: SimHandler): this {
    this.routes.push({ method: method.toUpperCase(), segments: split(pattern), handler })
    return this
  }

  match(method: string, path: string): { handler: SimHandler; params: Record<string, string> } | undefined {
    const parts = split(path)
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method.toUpperCase()) continue
      const params = matchSegments(route.segments, parts)
      if (params) return { handler: route.handler, params }
    }
    return undefined
  }
}

function split(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const seg = pattern[i]!
    if (seg === '*') {
      params['*'] = parts.slice(i).map(safeDecode).join('/')
      return params
    }
    const part = parts[i]
    if (part === undefined) return undefined
    if (seg.startsWith(':')) params[seg.slice(1)] = safeDecode(part)
    else if (seg !== part) return undefined
  }
  return parts.length === pattern.length ? params : undefined
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/** Read a whole request body (bounded, so a runaway client cannot exhaust memory). */
export async function readBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Wrap a node request + its raw body. */
export function toSimRequest(req: IncomingMessage, body: Buffer, params: Record<string, string> = {}): SimRequest {
  const url = new URL(req.url ?? '/', 'http://sandbox.local')
  const headers = req.headers
  return {
    method: (req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    query: url.searchParams,
    headers,
    body,
    params,
    json() {
      try { return JSON.parse(body.toString('utf8')) as unknown } catch { return undefined }
    },
    form() {
      return new URLSearchParams(body.toString('utf8'))
    },
    async multipart() {
      return new Response(new Uint8Array(body), { headers: { 'content-type': String(headers['content-type'] ?? '') } }).formData()
    },
    header(name: string) {
      const v = headers[name.toLowerCase()]
      return Array.isArray(v) ? v[0] : v
    },
  }
}

/** Serialize a {@link SimResponse} onto a node response. */
export function writeResponse(res: ServerResponse, out: SimResponse): void {
  const headers: Record<string, string> = { ...(out.headers ?? {}) }
  let payload: Buffer | string = ''
  if (Buffer.isBuffer(out.body)) payload = out.body
  else if (typeof out.body === 'string') payload = out.body
  else if (out.body !== undefined) {
    payload = JSON.stringify(out.body)
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json; charset=utf-8'
  }
  res.writeHead(out.status, headers)
  res.end(payload)
}

/** A started HTTP server and its base URL (`http://127.0.0.1:<port>`). */
export interface Listening {
  server: Server
  url: string
  port: number
  close(): Promise<void>
}

/**
 * Serve `handle` on `host:port` (default 127.0.0.1 and a free port). Never
 * `localhost`: on Windows it may resolve to ::1 first while the bot dials IPv4.
 */
export async function listen(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  opts: { port?: number; host?: string } = {},
): Promise<Listening> {
  const host = opts.host ?? '127.0.0.1'
  const server = createServer(handle)
  // Keep-alive sockets would hold close() open until they time out.
  server.keepAliveTimeout = 1_000
  // Unparseable requests get a JSON error like every other refusal (node's default is an empty 400).
  server.on('clientError', (err: NodeJS.ErrnoException, socket) => {
    if (!socket.writable) { socket.destroy(); return }
    const tooLarge = err.code === 'HPE_HEADER_OVERFLOW'
    const body = JSON.stringify({ error: tooLarge ? 'request headers too large' : `malformed HTTP request (${err.code ?? 'parse error'})` })
    socket.end(`HTTP/1.1 ${tooLarge ? '431 Request Header Fields Too Large' : '400 Bad Request'}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  return {
    server,
    port,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}
