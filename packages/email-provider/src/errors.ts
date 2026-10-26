/**
 * SMTP failure -> typed `ProviderError` mapping. Works on the error shape
 * nodemailer (and most SMTP clients) produce: `responseCode` (basic reply
 * code), `response` (full reply line, often with an enhanced status like
 * `5.1.1`) and `code` (`EAUTH`, `EENVELOPE`, `ECONNECTION`, ...).
 */

import {
  PayloadTooLargeError,
  ProviderError,
  RateLimitedError,
  RecipientUnreachableError,
  type ChatId,
} from '@botmesh/core'

/** Default back-off suggested for transient (4xx) SMTP failures. */
export const DEFAULT_SMTP_RETRY_MS = 60_000

interface SmtpErrorShape {
  message?: unknown
  code?: unknown
  responseCode?: unknown
  response?: unknown
}

/** nodemailer / socket codes for a connection that never carried an SMTP reply. */
const CONNECTION_CODES = new Set(['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EPROTOCOL', 'ETLS'])

/**
 * A short description when `err` is a TLS handshake failure (typically
 * implicit TLS against a plain-text or STARTTLS port), else `undefined`.
 */
export function tlsReason(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const e = err as { code?: unknown; library?: unknown; reason?: unknown; message?: unknown }
  const tls = (typeof e.code === 'string' && e.code.startsWith('ERR_SSL_'))
    || e.library === 'SSL routines'
    || (typeof e.message === 'string' && /SSL routines|wrong version number|packet length too long/i.test(e.message))
  if (!tls) return undefined
  return typeof e.reason === 'string' && e.reason ? `TLS handshake failed (${e.reason})` : 'TLS handshake failed'
}

/** Translate anything an SMTP send can throw into a typed provider error. */
export function toEmailError(err: unknown, chatId: ChatId): ProviderError {
  if (err instanceof ProviderError) return err
  const e = (typeof err === 'object' && err !== null ? err : {}) as SmtpErrorShape
  const message = typeof e.message === 'string' && e.message ? e.message : String(err)
  const code = typeof e.code === 'string' ? e.code : undefined
  const reply = typeof e.responseCode === 'number' ? e.responseCode : undefined
  const response = typeof e.response === 'string' ? e.response : message
  const enhanced = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(response)?.[0]

  if (code === 'EAUTH' || reply === 530 || reply === 534 || reply === 535) {
    return new ProviderError(`SMTP authentication failed — check smtp.user/pass (${message})`)
  }
  if (reply === undefined && code !== undefined && CONNECTION_CODES.has(code)) {
    return new ProviderError(`SMTP connection failed: ${tlsReason(err) ?? message}`)
  }
  // 552 is overloaded ("storage allocation exceeded"): the enhanced status says
  // whether the MAILBOX is full (5.2.2, the recipient cannot take mail) or the
  // MESSAGE is too big (5.3.4). Check the mailbox case first.
  if (enhanced === '5.2.2') return new RecipientUnreachableError(chatId, message)
  if (reply === 552 || enhanced === '5.3.4' || enhanced === '5.2.3' || /message (size|too (big|large))|exceeds.*size/i.test(response)) {
    return new PayloadTooLargeError(message)
  }
  if (reply !== undefined && reply >= 400 && reply < 500) {
    return new RateLimitedError(DEFAULT_SMTP_RETRY_MS, message)
  }
  if (reply === 550 || reply === 551 || reply === 553 || enhanced?.startsWith('5.1.') || enhanced === '5.2.1') {
    return new RecipientUnreachableError(chatId, message)
  }
  if (code === 'EENVELOPE') return new RecipientUnreachableError(chatId, message)
  return new ProviderError(message)
}

/**
 * @deprecated Use {@link toEmailError} (channel-prefixed like every provider's error
 * mapper). Removal planned for v3.
 */
export const toEmailProviderError: typeof toEmailError = toEmailError
