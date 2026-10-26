/**
 * Reconnect policy — pure decision logic for connection-close handling.
 *
 * Extracted from BaileysProvider so it can be unit-tested without a socket.
 * Maps a Baileys {@link DisconnectReason} status code to the action the
 * provider should take, and computes the backoff delay between attempts.
 */

import { DisconnectReason } from '@whiskeysockets/baileys'

export type DisconnectAction =
  /** Session is invalid — wipe auth state and start fresh. */
  | 'wipe'
  /** Do NOT reconnect — another client owns the session, or we're forbidden. */
  | 'stop'
  /** Reconnect immediately (normal post-pairing restart). */
  | 'reconnect-now'
  /** Reconnect after an exponential backoff delay. */
  | 'reconnect-backoff'

/**
 * Decide what to do when the socket closes, from the disconnect status code.
 *
 * - `loggedOut` / `badSession` / `multideviceMismatch` → `wipe`
 * - `connectionReplaced` (440, "conflict": another device/instance took the
 *   session) / `forbidden` (403) → `stop` — reconnecting just fights the other
 *   client forever and risks a ban
 * - `restartRequired` (515) → `reconnect-now` (expected during pairing)
 * - everything else (timeouts, transient closes, service unavailable) →
 *   `reconnect-backoff`
 */
export function classifyDisconnect(statusCode: number | undefined): DisconnectAction {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
    case DisconnectReason.badSession:
    case DisconnectReason.multideviceMismatch:
      return 'wipe'
    case DisconnectReason.connectionReplaced:
    case DisconnectReason.forbidden:
      return 'stop'
    case DisconnectReason.restartRequired:
      return 'reconnect-now'
    default:
      return 'reconnect-backoff'
  }
}

/**
 * Exponential backoff with a cap. `attempt` is 0-based (first retry = 0).
 *
 * @example
 * ```ts
 * backoffDelay(0) // 1000
 * backoffDelay(1) // 2000
 * backoffDelay(5) // 30000 (capped)
 * ```
 */
export function backoffDelay(attempt: number, base = 1000, cap = 30_000): number {
  if (attempt < 0) attempt = 0
  return Math.min(base * 2 ** attempt, cap)
}

/** Max consecutive backoff reconnect attempts before giving up. */
export const MAX_RECONNECT_ATTEMPTS = 10

/** `BaileysProviderConfig.reconnect` as an object: the backoff reconnect policy. */
export interface ReconnectPolicy {
  /** Consecutive backoff attempts before giving up (`closed` with "reconnect exhausted"). Default 10. */
  maxAttempts?: number
  /** First backoff delay in ms, doubled per attempt. Default 1000. */
  baseMs?: number
  /** Longest backoff delay in ms. Default 30000. */
  capMs?: number
}

/** A validated policy with every field set (`undefined` / `true` = the defaults). */
export function resolveReconnectPolicy(input: boolean | ReconnectPolicy | undefined): Required<ReconnectPolicy> {
  const policy = typeof input === 'object' && input !== null ? input : {}
  const out = {
    maxAttempts: policy.maxAttempts ?? MAX_RECONNECT_ATTEMPTS,
    baseMs: policy.baseMs ?? 1000,
    capMs: policy.capMs ?? Math.max(30_000, policy.baseMs ?? 0),
  }
  if (!Number.isSafeInteger(out.maxAttempts) || out.maxAttempts < 1) {
    throw new RangeError(`BaileysProvider: reconnect.maxAttempts must be a positive integer, got ${String(policy.maxAttempts)}`)
  }
  for (const field of ['baseMs', 'capMs'] as const) {
    if (!Number.isFinite(out[field]) || out[field] < 0 || out[field] > 2 ** 31 - 1) {
      throw new RangeError(`BaileysProvider: reconnect.${field} must be a number of milliseconds between 0 and 2^31-1, got ${String(policy[field])}`)
    }
  }
  if (out.capMs < out.baseMs) throw new RangeError(`BaileysProvider: reconnect.capMs (${out.capMs}) must be >= reconnect.baseMs (${out.baseMs})`)
  return out
}
