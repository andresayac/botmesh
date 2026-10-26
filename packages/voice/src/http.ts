/**
 * Internal HTTP helper shared by the built-in adapters: one `secureFetch` call
 * with the voice error mapping (timeouts, non-2xx, 429, transport failures).
 */

import { secureFetch, SecureHttpError } from '@botmesh/http'
import { VoiceError, VoiceHttpError, VoiceRateLimitedError, VoiceTimeoutError } from './errors.js'
import type { VoiceHttpOptions } from './types.js'

export const DEFAULT_TIMEOUT_MS = 60_000

export interface VoiceRequest {
  service: string
  url: string
  method?: 'POST' | 'GET'
  headers: Record<string, string>
  body?: Buffer | string
  signal?: AbortSignal
  /** Per-call timeout (`TranscribeOptions.timeoutMs` / `SynthesizeOptions.timeoutMs`). */
  timeoutMs?: number
  /** Default response cap when the adapter options don't set one. */
  defaultMaxBytes: number
  /** The credential sent with the request: scrubbed from any error detail the service echoes. */
  secret?: string
}

export interface VoiceResponse {
  body: Buffer
  headers: Headers
}

/** Join a base URL and a path without doubling or dropping slashes. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export async function voiceRequest(req: VoiceRequest, http: VoiceHttpOptions = {}): Promise<VoiceResponse> {
  const timeoutMs = effectiveTimeout(http.timeoutMs, req.timeoutMs)
  let result
  try {
    result = await secureFetch(req.url, {
      method: req.method ?? 'POST',
      headers: req.headers,
      body: req.body,
      signal: req.signal,
      timeoutMs,
      maxBytes: http.maxResponseBytes ?? req.defaultMaxBytes,
      maxRedirects: 0,
      allowHttp: http.allowHttp,
      allowPrivateHosts: http.allowPrivateHosts,
      ...(http.fetch ? { fetch: http.fetch } : {}),
      ...(http.resolver ? { resolver: http.resolver } : {}),
    })
  } catch (error) {
    if (error instanceof SecureHttpError && error.code === 'TIMEOUT') {
      throw new VoiceTimeoutError(req.service, timeoutMs, { cause: error })
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new VoiceError(`${req.service} request failed: ${reason}`, 'NETWORK', { cause: error })
  }

  const { response, body } = result
  if (response.status === 429) {
    throw new VoiceRateLimitedError(req.service, parseRetryAfter(response.headers.get('retry-after')), errorDetail(body, req.secret))
  }
  if (!response.ok) throw new VoiceHttpError(req.service, response.status, errorDetail(body, req.secret))
  return { body, headers: response.headers }
}

/** The tighter of the adapter timeout and the per-call one; `60_000` when neither is set. */
function effectiveTimeout(adapter: number | undefined, call: number | undefined): number {
  const set = [adapter, call].filter((v): v is number => typeof v === 'number' && v > 0)
  return set.length > 0 ? Math.min(...set) : DEFAULT_TIMEOUT_MS
}

/** Parse a JSON body or throw a `BAD_RESPONSE` VoiceError. */
export function parseJson(service: string, body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'))
  } catch (error) {
    throw new VoiceError(`${service} answered with a non-JSON body`, 'BAD_RESPONSE', { cause: error })
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** OpenAI-style keys, whole or masked (`sk-proj-****abcd`), as services quote them in errors. */
const KEY_LIKE = /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9*_-]{4,}/g

/**
 * Best-effort short error detail from the common shapes (OpenAI, Deepgram, ElevenLabs).
 * Error messages are logged, so the request's credential (and anything key-shaped) is
 * scrubbed before the detail is cut to length.
 */
function errorDetail(body: Buffer, secret?: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return undefined
  }
  const pick = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
  const root = obj(parsed)
  if (!root) return undefined
  const detail =
    pick(obj(root.error)?.message) ??
    pick(root.error) ??
    pick(root.err_msg) ??
    pick(obj(root.detail)?.message) ??
    pick(root.detail) ??
    pick(root.message)
  if (!detail) return undefined
  let safe = secret && secret.length >= 4 ? detail.split(secret).join('[redacted]') : detail
  safe = safe.replace(KEY_LIKE, '[redacted]')
  return safe.slice(0, 200)
}
