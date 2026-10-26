/**
 * Unified Meta Graph error mapping. A single superset that covers WhatsApp Cloud
 * API business codes AND the generic Facebook/Instagram rate-limit codes, so all
 * three transports share one (complete) mapping instead of three divergent ones.
 */

import {
  ProviderError,
  PayloadTooLargeError,
  OutsideSessionWindowError,
  RecipientUnreachableError,
  RateLimitedError,
  UnsupportedContentError,
  type ChatId,
  type OutboundContent,
} from '@botmesh/core'

export interface GraphError {
  code?: number
  message?: string
  error_subcode?: number
}

export interface GraphErrorOptions {
  /** The recipient the failing call targeted — enriches window/unreachable errors. */
  chatId?: ChatId
  /** Server-signalled retry delay in ms (from a Retry-After header). */
  retryAfterMs?: number
  /**
   * The `OutboundContent` kind of the failing send, when the caller knows it.
   * Becomes `UnsupportedContentError.kind` for the "unsupported content" codes
   * (131051, 131062); without it each code falls back to its most likely kind.
   */
  contentKind?: OutboundContent['kind']
}

/**
 * Messenger Platform (Messenger + Instagram DM) send failures, keyed by subcode:
 *  - outside the messaging window: code 10 with subcode 2018278 (Messenger) or
 *    2534022 (Instagram) -> {@link OutsideSessionWindowError};
 *  - recipient gone / unknown: code 551 ("This person isn't available right
 *    now"), subcodes 1545041, 2018001 and 2534014 ("No matching user found")
 *    -> {@link RecipientUnreachableError}.
 */
const WINDOW_SUBCODES = new Set([2018278, 2534022])
const UNREACHABLE_SUBCODES = new Set([1545041, 2018001, 2534014])

/** Translate a Graph error into the core's typed provider error. */
export function toGraphError(err: GraphError, opts: GraphErrorOptions = {}): ProviderError {
  // The body is external JSON: accept a numeric string code, ignore a non-string message.
  const code = graphNumber(err?.code)
  const subcode = graphNumber(err?.error_subcode)
  const msg = typeof err?.message === 'string' && err.message.length > 0 ? err.message : 'Graph API error'
  const chatId = opts.chatId ?? ''
  // Subcodes are more specific than codes (the window error is a plain code 10),
  // so they are checked first.
  if (subcode !== undefined) {
    const tag = `${code ?? '?'}/${subcode}`
    if (WINDOW_SUBCODES.has(subcode)) {
      return new OutsideSessionWindowError(chatId, `${msg} (${tag}) — the user must write first (24h window) or use a message tag.`)
    }
    if (UNREACHABLE_SUBCODES.has(subcode)) return new RecipientUnreachableError(chatId, `${msg} (${tag})`)
  }
  switch (code) {
    case 131047: // re-engagement: outside the 24h free-form window (WhatsApp)
      return new OutsideSessionWindowError(chatId, `${msg} (131047) — send a template (kind template).`)
    case 131026: // message undeliverable (recipient can't receive)
      return new RecipientUnreachableError(chatId, `${msg} (131026)`)
    case 131030: // recipient not in the test number's allowed list (WhatsApp)
      return new RecipientUnreachableError(
        chatId,
        `${msg} (131030) — add the recipient to the allowed list of your test number, or send from a production number.`,
      )
    case 551:    // Messenger Platform: "This person isn't available right now"
      return new RecipientUnreachableError(chatId, `${msg} (551${subcode ? `/${subcode}` : ''})`)
    // Code 10 (permission denied) is only a window error with a window subcode,
    // handled above; a bare code 10 falls through to the generic error.
    case 131051: // unsupported message type
      return new UnsupportedContentError(opts.contentKind ?? 'native', `${msg} (131051)`)
    case 131062: // BSUID recipient not supported for this message (WhatsApp): only the
                 // one-tap / zero-tap / copy-code authentication templates need a phone number
      return new UnsupportedContentError(
        opts.contentKind ?? 'template',
        `${msg} (131062) — send it to the user's phone number (wa_id), not the business-scoped user id.`,
      )
    case 4:      // app-level rate limit
    case 613:    // calls to this API have exceeded the rate limit
    case 80007:  // account-level rate limit
    case 36003:  // business rate limit
      return new RateLimitedError(opts.retryAfterMs ?? 60_000, `${msg} (${code})`)
    case 130429: // WhatsApp Cloud API throughput (messages per second) reached
      return new RateLimitedError(opts.retryAfterMs ?? 1_000, `${msg} (130429)`)
    case 131056: // WhatsApp pair rate limit: too many messages to the same user
      return new RateLimitedError(opts.retryAfterMs ?? 6_000, `${msg} (131056)`)
    case 131048: // WhatsApp spam rate limit: the number's sends are restricted
      return new RateLimitedError(opts.retryAfterMs ?? 60_000, `${msg} (131048)`)
    // Setup mistakes: still a generic ProviderError, with a hint at the config to check.
    case 190:    // invalid / expired / unparsable access token
      return new ProviderError(`${msg} (code 190) — the access token is invalid or expired: use a permanent system-user token with the messaging permission.`)
    case 100:    // subcode 33: the object (phone number / page / WABA id) does not exist or is not accessible
      if (subcode === 33) {
        return new ProviderError(`${msg} (code 100/33) — check the configured phone number id (or page / WABA id) and that the token can access it.`)
      }
      return new ProviderError(`${msg} (code 100${subcode !== undefined ? `/${subcode}` : ''})`)
    // 147001-147005 (business-username API: not available, not eligible, FB/IG not
    // linked, transfer required) fall through on purpose: they are account-management
    // failures, not send failures, so no typed send error fits.
    default:
      return new ProviderError(`${msg}${code ? ` (code ${code})` : ''}`)
  }
}

/** A Graph numeric field (code / subcode), also when it arrives as a digit string. */
function graphNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return typeof value === 'string' && /^\d{1,12}$/.test(value.trim()) ? Number(value.trim()) : undefined
}

/**
 * Upper bound of a server-sent `Retry-After` (24 h). Callers feed
 * `retryAfterMs` straight into timers, and a delay above 2^31-1 ms makes
 * `setTimeout` fire after 1 ms: a broken proxy would turn a rate limit into a
 * retry storm.
 */
const MAX_RETRY_AFTER_MS = 86_400_000

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** IMF-fixdate: `Sun, 06 Nov 1994 08:49:37 GMT`. */
const IMF_FIXDATE = /^(?:mon|tue|wed|thu|fri|sat|sun), (\d{1,2}) ([a-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) gmt$/i
/** Obsolete RFC 850: `Sunday, 06-Nov-94 08:49:37 GMT`. */
const RFC_850 = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday), (\d{1,2})-([a-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) gmt$/i
/** Obsolete asctime: `Sun Nov  6 08:49:37 1994` (always GMT). */
const ASCTIME = /^(?:mon|tue|wed|thu|fri|sat|sun) ([a-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/i

/**
 * An HTTP-date (RFC 9110 §5.6.7: IMF-fixdate, RFC 850 or asctime) as epoch ms,
 * or `NaN`. Strict on purpose: the engine's lenient `Date.parse` reads
 * garbage like `"abc 5"` as a date in 2001.
 */
function parseHttpDate(text: string): number {
  const value = text.replace(/\s+/g, ' ')
  // Normalized as [day, month, year, hours, minutes, seconds].
  let parts: string[]
  let match: RegExpExecArray | null
  if ((match = IMF_FIXDATE.exec(value))) {
    parts = match.slice(1)
  } else if ((match = RFC_850.exec(value))) {
    parts = match.slice(1)
    // A two-digit year more than 50 years in the future is in the past century.
    let year = 2000 + Number(parts[2])
    if (year > new Date().getUTCFullYear() + 50) year -= 100
    parts[2] = String(year)
  } else if ((match = ASCTIME.exec(value))) {
    const [month, day, hh, mm, ss, year] = match.slice(1) as [string, string, string, string, string, string]
    parts = [day, month, year, hh, mm, ss]
  } else {
    return Number.NaN
  }
  const month = MONTHS.indexOf(parts[1]!.toLowerCase())
  const [day, year, hh, mm, ss] = [parts[0], parts[2], parts[3], parts[4], parts[5]].map(Number) as [number, number, number, number, number]
  if (month < 0 || day < 1 || hh > 23 || mm > 59 || ss > 60) return Number.NaN
  const at = Date.UTC(year, month, day, hh, mm, Math.min(ss, 59))
  // Reject a day the month does not have (`31 Feb` would roll into March).
  return new Date(at).getUTCDate() === day ? at : Number.NaN
}

/**
 * `Retry-After` in ms: delay-seconds (`"7"`, also fractional) or an HTTP-date
 * (a past date means now). `undefined` when absent or unparsable, so the code's
 * default applies; never negative and never above {@link MAX_RETRY_AFTER_MS}.
 */
function retryAfterMs(header: string | null): number | undefined {
  const text = header?.trim()
  if (!text) return undefined
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.min(MAX_RETRY_AFTER_MS, Math.round(Number(text) * 1000))
  const at = parseHttpDate(text)
  return Number.isNaN(at) ? undefined : Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - Date.now()))
}

/** The subset of a fetch `Response` that {@link readGraphResponse} reads. */
export interface GraphResponseLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

/**
 * Read a Graph API response: resolve to its JSON body (an unparsable body is
 * `{}`), or reject with the typed error {@link toGraphError} maps it to when the
 * HTTP status fails or the body carries an `error`. A `Retry-After` header
 * (seconds or an HTTP-date) overrides `opts.retryAfterMs`.
 *
 * This is the single response check shared by the WhatsApp Cloud API,
 * Messenger and Instagram clients, so the Messenger Platform window /
 * unreachable codes are mapped in exactly one place.
 */
export async function readGraphResponse<T = unknown>(res: GraphResponseLike, opts: GraphErrorOptions = {}): Promise<T> {
  const parsed = await res.json().catch(() => ({}))
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as { error?: GraphError }
  if (!res.ok || body.error) {
    const error = body.error && typeof body.error === 'object' ? body.error : { message: `HTTP ${res.status}` }
    const mapped = toGraphError(error, { ...opts, retryAfterMs: retryAfterMs(res.headers.get('Retry-After')) ?? opts.retryAfterMs })
    // An oversized request (media upload, long body) is refused with HTTP 413 by Graph's
    // front end, usually with no Graph code: report it as too large unless a code says more.
    if (res.status === 413 && mapped.constructor === ProviderError) throw new PayloadTooLargeError(mapped.message)
    throw mapped
  }
  return body as T
}
