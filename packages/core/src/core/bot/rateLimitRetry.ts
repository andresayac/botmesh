/**
 * The short in-place retry of rate-limited `ctx` replies (`BotConfig.rateLimitRetry`):
 * the resolved policy and the retrying `provider.send` the outbound pipeline uses.
 */
import { abortableSleep, parseTimerDuration } from '../../utils/timers.js'
import { RateLimitedError } from '../provider.js'
import type { ChatId, OutboundContent, SendOptions, SendResult } from '../types.js'
import { assertCoordinated, type BotKernel } from './kernel.js'

/**
 * A `ctx` reply that hits a `RateLimitedError` is retried in place (same payload, no hooks
 * re-run) when the transport asks for a short wait, so a conversation step does not end
 * on a transient 429 (`BotConfig.rateLimitRetry`, default one retry within 5 s). Longer
 * waits, other errors and `bot.send()` (broadcasts have their own back-off) surface as
 * before; durable sends retry through their outbox instead.
 */
const CTX_RATE_LIMIT_RETRIES = 1
const CTX_RATE_LIMIT_MAX_WAIT_MS = 5_000

/** Resolved `BotConfig.rateLimitRetry` (`null` = off). */
export interface RateLimitRetryPolicy { readonly retries: number; readonly maxWaitMs: number }

export function rateLimitPolicy(config: BotKernel['config']): RateLimitRetryPolicy | null {
  const option = config.rateLimitRetry
  if (option === false) return null
  return {
    retries: option?.retries ?? CTX_RATE_LIMIT_RETRIES,
    maxWaitMs: option?.maxWaitMs !== undefined ? parseTimerDuration(option.maxWaitMs, 'rateLimitRetry.maxWaitMs') : CTX_RATE_LIMIT_MAX_WAIT_MS,
  }
}

function shortRateLimit(error: unknown, maxWaitMs: number): number | undefined {
  if (!(error instanceof RateLimitedError)) return undefined
  const wait = Number(error.retryAfterMs)
  return Number.isFinite(wait) && wait >= 0 && wait <= maxWaitMs ? wait : undefined
}

/** `provider.send` with the short rate-limit retry of `ctx` replies (`BotConfig.rateLimitRetry`). */
export async function sendRetryingRateLimit(
  k: BotKernel, payload: { chatId: ChatId; content: OutboundContent; options?: SendOptions }, policy: RateLimitRetryPolicy,
): Promise<SendResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await k.provider.send(payload.chatId, payload.content, payload.options)
    } catch (error) {
      const wait = attempt < policy.retries ? shortRateLimit(error, policy.maxWaitMs) : undefined
      const stop = k.state.sendsAbort.signal
      if (wait === undefined || stop.aborted) throw error
      await abortableSleep(wait, stop)
      if (stop.aborted) throw error
      assertCoordinated(k)
    }
  }
}
