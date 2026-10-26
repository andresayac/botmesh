/**
 * Presence hints (`typing`, `markRead`) while the transport is disconnected — one policy for
 * every channel (see "PRESENCE WHILE DISCONNECTED" in `IProvider`): they are best-effort.
 * While the provider's last connection update is not `'ready'`, or once the transport is
 * stopped, the bot does not call the provider; the hint resolves without effect, is logged
 * at debug and counted in `metrics().presenceSkipped`. While the bot runs and the provider
 * has not reported any connection state (a custom provider that never does), nothing is
 * gated.
 */
import type { ChatId } from '../provider.js'
import type { BotKernel } from './kernel.js'

/** A presence hint the bot may skip while disconnected. */
export type PresenceHint = 'typing' | 'markRead'

/**
 * `true` when the hint may reach the provider. `false` (already logged and counted) while
 * the transport is known to be disconnected.
 */
export function presenceAllowed(k: BotKernel, kind: PresenceHint, chatId: ChatId): boolean {
  const { state } = k
  // The transport is stopped (after `stop()`), or reported a state other than 'ready'.
  const connection = !state.sendsOpen ? 'closed' : state.connReported ? state.connState : 'ready'
  if (connection === 'ready') return true
  k.counters.presenceSkipped(kind)
  k.logger.debug({ chatId: k.logId(chatId), kind, connection }, 'presence hint skipped: transport not connected')
  return false
}
