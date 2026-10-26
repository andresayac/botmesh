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

/** Answer of {@link restCall}: any HTTP status resolves (check `ok`); `body` is parsed JSON or the raw text. */
export interface RestResponse {
  status: number
  ok: boolean
  body: unknown
  /** Parsed `Retry-After`, when the server sent one. */
  retryAfterMs?: number
}

/** `Retry-After` header (delay in seconds or an HTTP date) in milliseconds; `undefined` when absent or unparsable. */
export function parseRetryAfter(value: string | null): number | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  // RFC 9110: delay-seconds is a non-negative decimal integer. Hex, exponents, signs and
  // whitespace-only values (which `Number()` would accept) are ignored rather than guessed.
  if (/^\d+$/.test(raw)) return Number(raw) * 1000
  if (/^[\d.+-]|^0x/i.test(raw)) return undefined
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

/**
 * Validate and normalize a gateway base URL at construction time, so a typo
 * (`localhost:8080` without the scheme) fails with an actionable message
 * instead of a misleading "only HTTPS URLs are allowed" on the first request.
 *
 * @throws {TypeError} when `baseUrl` is not an absolute http(s) URL.
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
    throw new TypeError(`${owner}: \`baseUrl\` must be an absolute http(s) URL such as 'http://127.0.0.1:8080' (got ${redactUrl(baseUrl)})`)
  }
  if (parsed.username || parsed.password) {
    throw new TypeError(`${owner}: \`baseUrl\` must not contain credentials (user:password@); pass the gateway key in its own option (got ${redactUrl(baseUrl)})`)
  }
  // Request paths are appended to the base URL, so a query string or fragment would end up in the middle of every URL.
  if (parsed.search || raw.includes('?')) {
    throw new TypeError(`${owner}: \`baseUrl\` must not have a query string; request paths are appended to it (got ${redactUrl(baseUrl)})`)
  }
  if (parsed.hash || raw.includes('#')) {
    throw new TypeError(`${owner}: \`baseUrl\` must not have a fragment (#...); request paths are appended to it (got ${redactUrl(baseUrl)})`)
  }
  return raw.replace(/\/+$/, '')
}

/** The base URL as shown in errors: user info (`user:password@`) masked, at most 120 characters. */
function redactUrl(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value) ?? String(value)
  const masked = value.replace(/^([a-z][a-z\d+.-]*:\/\/)?[^/?#@]*@/i, '$1***@')
  return JSON.stringify(masked.length > 120 ? `${masked.slice(0, 120)}…` : masked)
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

/**
 * Fill the {@link RestHttpOptions} defaults for a gateway at `baseUrl`: plain HTTP allowed when the
 * base URL uses it, private hosts allowed, 30 s timeout, 64 MiB response ceiling.
 */
export function resolveHttpPolicy(baseUrl: string, http: RestHttpOptions = {}): RestHttpOptions {
  const timeoutMs = http.timeoutMs ?? 30_000
  const maxBytes = http.maxBytes ?? 64 * 1024 * 1024
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`\`http.timeoutMs\` must be a positive number of milliseconds (got ${String(http.timeoutMs)})`)
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError(`\`http.maxBytes\` must be a non-negative integer number of bytes (got ${String(http.maxBytes)})`)
  }
  return {
    allowHttp: http.allowHttp ?? /^http:\/\//i.test(baseUrl),
    allowPrivateHosts: http.allowPrivateHosts ?? true,
    timeoutMs,
    maxBytes,
    resolver: http.resolver,
    fetch: http.fetch,
  }
}

/**
 * One JSON request to the gateway through `secureFetch` (@botmesh/http), never following redirects.
 * Resolves for every HTTP status (map `status` to a typed error yourself).
 *
 * @throws {ProviderError} on a network failure (DNS, refused, timeout, size limit), an invalid URL or a
 * body that `JSON.stringify` cannot serialize, naming the cause and `init.label` (or the URL path).
 */
export async function restCall(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown; /** Shown in errors instead of the URL path (keep secrets out of logs). */ label?: string },
  http: RestHttpOptions,
): Promise<RestResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers }
  const what = (): string => `${init.method} ${init.label ?? pathOf(url)}`
  let body: string | undefined
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    try {
      body = JSON.stringify(init.body)
    } catch (err) {
      throw Object.assign(new ProviderError(`gateway request failed: ${what()}: the body is not JSON-serializable (${describeTransportError(err)})`), { cause: err })
    }
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
    if ((err as { code?: unknown }).code === 'TOO_MANY_REDIRECTS') {
      throw new ProviderError(`gateway request failed: ${what()}: the gateway answered a redirect (HTTP 3xx), and gateway calls never follow redirects; check \`baseUrl\` (http vs https, host, path prefix)`)
    }
    const detail = describeTransportError(err)
    throw new ProviderError(`gateway request failed: ${what()}: ${detail}`)
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

/** URL path for error messages (never the query string, which may carry tokens). */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return '(invalid URL)'
  }
}

/** Plain-object type guard (not `null`, not an array). */
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
    if (typeof c === 'string' && c) return c.slice(0, 300)
    if (Array.isArray(c) && c.length) return JSON.stringify(c).slice(0, 300)
  }
  return JSON.stringify(body).slice(0, 300)
}
