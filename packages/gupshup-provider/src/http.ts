/**
 * Small transport helpers shared by the provider: header lookup, raw-body
 * handling, constant-time comparison, the numbered-text fallback for buttons /
 * lists, and the REST call wrapper over `secureFetch` (@botmesh/http).
 */

import { timingSafeEqual } from 'node:crypto'
import { SecureHttpError, secureFetch, type SecureFetchOptions } from '@botmesh/http'
import { PayloadTooLargeError, ProviderError } from '@botmesh/core'

export type HeaderBag = Record<string, string | string[] | undefined>

/** HTTP options forwarded to `secureFetch` for every request the provider makes. */
export type ProviderHttpOptions = Pick<
  SecureFetchOptions,
  'timeoutMs' | 'maxBytes' | 'maxRedirects' | 'resolver' | 'allowHttp' | 'allowPrivateHosts' | 'fetch'
>

/** Case-insensitive header read; the first value wins for repeated headers. */
export function header(headers: HeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    return Array.isArray(value) ? value[0] : value
  }
  return undefined
}

/** Raw request bytes as a UTF-8 string, or undefined when the body was already parsed. */
export function rawText(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  return undefined
}

/** Constant-time string equality (length leaks, content does not). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Render buttons / list rows as a numbered text menu; a URL button keeps its link (`1. Pay: https://…`). */
export function numberedText(text: string, items: ReadonlyArray<{ title: string; url?: string }>, footer?: string): string {
  const lines = items.map((item, index) => `${index + 1}. ${item.title}${item.url ? `: ${item.url}` : ''}`)
  return [text, '', ...lines, ...(footer ? ['', footer] : [])].join('\n')
}

export interface HttpResult {
  status: number
  ok: boolean
  headers: Headers
  /** Parsed JSON body, or `{}` when the body is empty / not JSON. */
  json: Record<string, unknown>
  body: Buffer
}

/**
 * `secureFetch` whose transport failures (DNS, TLS, reset, timeout, policy
 * refusals) reject with a typed {@link ProviderError} carrying the original as
 * `cause`; an oversized response becomes a {@link PayloadTooLargeError}.
 */
export async function fetchTyped(url: string, init: SecureFetchOptions): Promise<{ response: Response; body: Buffer }> {
  try {
    return await secureFetch(url, init)
  } catch (err) {
    const detail = describeFailure(err)
    const wrapped = err instanceof SecureHttpError && err.code === 'RESPONSE_TOO_LARGE'
      ? new PayloadTooLargeError(`Gupshup response too large: ${detail}`)
      : new ProviderError(`Gupshup request failed: ${init.method ?? 'GET'} ${safePath(url)}: ${detail}`)
    ;(wrapped as { cause?: unknown }).cause = err
    throw wrapped
  }
}

/** The error message plus the first network error code in its cause chain (`fetch failed (ECONNREFUSED)`). */
function describeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  let current: unknown = err
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^E[A-Z0-9_]+$/.test(code)) return message.includes(code) ? message : `${message} (${code})`
    current = (current as { cause?: unknown }).cause
  }
  return message
}

/** Origin + path of a URL for error messages: never its query (signed media URLs carry tokens there). */
function safePath(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return '<invalid url>'
  }
}

/** One REST call through `secureFetch`; never throws on HTTP status (callers map errors). */
export async function request(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  http: ProviderHttpOptions | undefined,
): Promise<HttpResult> {
  const { response, body } = await fetchTyped(url, { ...http, ...init })
  let json: Record<string, unknown> = {}
  if (body.length > 0) {
    try {
      const parsed: unknown = JSON.parse(body.toString('utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
    } catch {
      // Non-JSON error page; callers fall back to the HTTP status.
    }
  }
  return { status: response.status, ok: response.ok, headers: response.headers, json, body }
}

/** Longest `Retry-After` honoured: 24 h (as in `@botmesh/graph-core`; more would overflow `setTimeout`). */
const MAX_RETRY_AFTER_MS = 86_400_000

/** `Retry-After` (seconds or HTTP date) in ms, capped at 24 h, or undefined. */
export function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000))
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()))
  return undefined
}
