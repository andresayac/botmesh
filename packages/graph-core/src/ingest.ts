/**
 * Shared webhook-ingest guard for the Graph transports. Encapsulates the
 * (previously triplicated) appSecret check: raw-body handling, the
 * X-Hub-Signature-256 verification, and the "non-raw body while appSecret set"
 * footgun warning.
 */

import { verifySignature } from './webhook.js'

export interface GraphIngestLogger {
  warn?: (msg: string) => void
}

export type GraphSignatureResult =
  | { ok: true }
  | { ok: false; status: number }

/** Headers as Node's `IncomingMessage` (or most frameworks) hand them over. */
export type GraphWebhookHeaders = Record<string, string | string[] | undefined>

/** Input of {@link checkGraphSignature}. */
export interface GraphSignatureOptions {
  /**
   * The request body exactly as received: a `string`, `Buffer`, `Uint8Array` or
   * `ArrayBuffer`. An already-parsed object is rejected (400) when `appSecret` is set,
   * because Meta signs the bytes it sent and re-serialization is not equivalent.
   */
  body: unknown
  /** Request headers; `X-Hub-Signature-256` is read case-insensitively. */
  headers?: GraphWebhookHeaders
  /** The app secret. Without it the request passes (local development only). */
  appSecret?: string
  /** Receives a warning when a request is rejected. */
  logger?: GraphIngestLogger
}

/**
 * Verify an inbound webhook's signature when `appSecret` is configured.
 *
 * - No `appSecret` → `{ ok: true }` (the provider only permits this after an
 *   explicit local-development opt-out).
 * - `appSecret` set → checks `X-Hub-Signature-256` over the RAW request bytes.
 *   A non-raw (already-parsed) body is rejected because Meta signs the exact
 *   bytes it sent and re-serialization is not equivalent.
 */
export function checkGraphSignature(options: GraphSignatureOptions): GraphSignatureResult
/**
 * @deprecated Pass one options object: `checkGraphSignature({ body, headers, appSecret, logger })`.
 * The positional form stays until the next major.
 */
export function checkGraphSignature(
  body: unknown,
  headers: GraphWebhookHeaders | undefined,
  appSecret: string | undefined,
  logger?: GraphIngestLogger,
): GraphSignatureResult
export function checkGraphSignature(
  ...args: [GraphSignatureOptions] | [unknown, GraphWebhookHeaders | undefined, string | undefined, GraphIngestLogger?]
): GraphSignatureResult {
  // One argument is the options object; two or more are the positional form, whatever the body is.
  const { body, headers, appSecret, logger } = args.length === 1
    ? (args[0] ?? { body: undefined })
    : { body: args[0], headers: args[1], appSecret: args[2], logger: args[3] }
  return verifyGraphSignature(body, headers, appSecret, logger)
}

function verifyGraphSignature(
  body: unknown,
  headers: GraphWebhookHeaders | undefined,
  appSecret: string | undefined,
  logger: GraphIngestLogger | undefined,
): GraphSignatureResult {
  if (!appSecret) return { ok: true }
  const raw = rawBodyOf(body)
  if (raw === undefined) {
    logger?.warn?.(
      'ingest received a non-raw body while appSecret is set — signature verification needs the raw ' +
        'request bytes (use express.raw()/the raw body string).',
    )
    return { ok: false, status: 400 }
  }
  const sig = headerValue(headers, 'x-hub-signature-256')
  const sigStr = Array.isArray(sig) ? sig[0] : sig
  if (!verifySignature(raw, sigStr, appSecret)) {
    logger?.warn?.('webhook rejected: invalid X-Hub-Signature-256')
    return { ok: false, status: 403 }
  }
  return { ok: true }
}

/** Case-insensitive header read (hosts may hand over `X-Hub-Signature-256` as sent). */
function headerValue(headers: GraphWebhookHeaders | undefined, name: string): string | string[] | undefined {
  if (!headers) return undefined
  if (headers[name] !== undefined) return headers[name]
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name) return value
  return undefined
}

/** The raw request bytes as a string/Buffer, or undefined for an already-parsed body. */
function rawBodyOf(body: unknown): string | Buffer | undefined {
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  return undefined
}

/**
 * Parse a webhook body (raw string, Buffer/Uint8Array, or already-parsed object)
 * into T. Throws a `SyntaxError` on a raw body that is not JSON; use
 * {@link tryParseGraphBody} to answer such a request with a 400 instead.
 */
export function parseGraphBody<T>(body: unknown): T {
  const raw = rawBodyOf(body)
  if (raw === undefined) return body as T
  return JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as T
}

/** Outcome of {@link tryParseGraphBody}. */
export type GraphParseResult<T> = { ok: true; body: T } | { ok: false; status: 400 }

/**
 * Non-throwing {@link parseGraphBody}: a raw body that is not a JSON object (bad
 * JSON, an array, a bare value) yields `{ ok: false, status: 400 }`, so a webhook
 * handler can answer 400 instead of crashing on malformed input.
 */
export function tryParseGraphBody<T>(body: unknown): GraphParseResult<T> {
  let parsed: unknown
  try {
    parsed = parseGraphBody<unknown>(body)
  } catch {
    return { ok: false, status: 400 }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, status: 400 }
  return { ok: true, body: parsed as T }
}
