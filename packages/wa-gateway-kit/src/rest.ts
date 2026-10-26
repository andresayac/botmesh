/**
 * Minimal JSON-over-HTTP client on top of `secureFetch` (@botmesh/http).
 *
 * The gateway base URL is operator configuration, usually a self-hosted
 * container on `http://localhost` / a private network, so by default plain HTTP
 * is allowed when the base URL uses it and private hosts are allowed. Redirects
 * are NOT followed (`maxRedirects: 0`): an API call that answers 3xx is an error,
 * never a hop to a URL nobody configured.
 */

import { secureFetch, type HostResolver } from '@botmesh/http'
import { ProviderError } from '@botmesh/core'

/** Network policy for calls to the gateway's REST API. */
export interface RestHttpOptions {
  /** Allow `http://` base URLs. Default: `true` when `baseUrl` starts with `http://`. */
  allowHttp?: boolean
  /** Allow loopback/private destinations. Default `true` (self-hosted gateway). */
  allowPrivateHosts?: boolean
  /** Per-request timeout. Default 30 000 ms. */
  timeoutMs?: number
  /** Response size ceiling (base64 media comes back inline). Default 64 MiB. */
  maxBytes?: number
  /** DNS override (tests, egress gateways). */
  resolver?: HostResolver
  /** fetch override (tests, custom dispatchers). */
  fetch?: typeof globalThis.fetch
}

export interface RestResponse {
  status: number
  ok: boolean
  body: unknown
  /** Parsed `Retry-After`, when the server sent one. */
  retryAfterMs?: number
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

/**
 * Validate and normalize a gateway base URL at construction time, so a typo
 * (`localhost:8080` without the scheme) fails with an actionable message
 * instead of a misleading "only HTTPS URLs are allowed" on the first request.
 */
export function gatewayBaseUrl(owner: string, baseUrl: unknown): string {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  let parsed: URL | undefined
  try {
    parsed = new URL(raw)
  } catch {
    parsed = undefined
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new Error(`${owner}: \`baseUrl\` must be an absolute http(s) URL such as 'http://127.0.0.1:8080' (got ${JSON.stringify(baseUrl)})`)
  }
  return raw.replace(/\/+$/, '')
}

/** "fetch failed" says nothing: also surface the network error code/message carried in `cause`. */
function describeTransportError(err: unknown): string {
  const parts: string[] = []
  let cur: unknown = err
  for (let depth = 0; cur && depth < 4; depth++) {
    const e = cur as { message?: unknown; code?: unknown; cause?: unknown }
    for (const piece of [e.code, e.message]) {
      if (typeof piece === 'string' && piece && !parts.some((p) => p.includes(piece))) parts.push(piece)
    }
    cur = e.cause
  }
  return parts.join(': ') || String(err)
}

export function resolveHttpPolicy(baseUrl: string, http: RestHttpOptions = {}): RestHttpOptions {
  return {
    allowHttp: http.allowHttp ?? /^http:\/\//i.test(baseUrl),
    allowPrivateHosts: http.allowPrivateHosts ?? true,
    timeoutMs: http.timeoutMs ?? 30_000,
    maxBytes: http.maxBytes ?? 64 * 1024 * 1024,
    resolver: http.resolver,
    fetch: http.fetch,
  }
}

export async function restCall(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown; /** Shown in errors instead of the URL path (keep secrets out of logs). */ label?: string },
  http: RestHttpOptions,
): Promise<RestResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers }
  let body: string | undefined
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  let result
  try {
    result = await secureFetch(url, {
      method: init.method,
      headers,
      body,
      maxRedirects: 0,
      allowHttp: http.allowHttp,
      allowPrivateHosts: http.allowPrivateHosts,
      timeoutMs: http.timeoutMs,
      maxBytes: http.maxBytes,
      ...(http.resolver ? { resolver: http.resolver } : {}),
      ...(http.fetch ? { fetch: http.fetch } : {}),
    })
  } catch (err) {
    const detail = describeTransportError(err)
    throw new ProviderError(`gateway request failed: ${init.method} ${init.label ?? new URL(url).pathname}: ${detail}`)
  }
  const { response } = result
  const text = result.body.toString('utf8')
  let parsed: unknown = text
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    body: parsed,
    retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
  }
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Flatten whatever error body a gateway returned into one readable line. */
export function describeErrorBody(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300)
  if (!isRecord(body)) return ''
  const response = isRecord(body.response) ? body.response : undefined
  const candidates = [response?.message, body.message, body.error]
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c
    if (Array.isArray(c) && c.length) return JSON.stringify(c).slice(0, 300)
  }
  return JSON.stringify(body).slice(0, 300)
}
