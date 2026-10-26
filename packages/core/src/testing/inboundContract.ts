/**
 * Inbound shape contract — reusable checks for provider test suites, next to the identity
 * stability contract (`identityContract.ts`).
 *
 * Every provider emits the same units and shapes, whatever its transport sends:
 *
 * - `timestamp` of a message, an interaction and a delivery status is **epoch
 *   milliseconds** (an integer). Transports that send seconds (WhatsApp, Telegram, the
 *   Cloud API) multiply by 1000; transports that send none use the receive time
 *   (`Date.now()`), never `0`.
 * - `respondBy` of an interaction is epoch ms, not before its `timestamp`.
 * - A message has a string `body`, a `mentions` array and a known `MessageType`.
 *
 * Runner-agnostic: {@link checkInboundContract} returns the violations and
 * {@link assertInboundContract} throws them.
 *
 * @example
 * ```ts
 * import { assertInboundContract, recordEvents } from '@botmesh/core/testing'
 *
 * const rec = recordEvents(provider)
 * await provider.ingest(webhookBody)
 * assertInboundContract(rec.events)
 * ```
 */

import type { InboundEvent, InboundInteraction, InboundMessage, MessageType } from '../core/provider.js'

/**
 * Anything a provider test may hold: the `InboundEvent` wrapper or a bare message/interaction.
 *
 * @category Contract checks
 */
export type InboundContractInput = InboundEvent | InboundMessage | InboundInteraction

/**
 * Tuning for {@link checkInboundContract}.
 *
 * @category Contract checks
 */
export interface InboundContractOptions {
  /** Reference "now" (epoch ms) for the future check. Default `Date.now()`. */
  now?: number
  /** How far past `now` a timestamp may be (clock skew). Default 24 h. */
  maxFutureSkewMs?: number
  /**
   * Smallest plausible epoch-ms timestamp. Default `1e12` (September 2001): anything
   * smaller is epoch seconds (or garbage).
   */
  minTimestamp?: number
}

/**
 * Machine-readable rule ids reported in {@link InboundViolation.rule}.
 *
 * @category Contract checks
 */
export type InboundRule =
  | 'timestamp-missing'
  | 'timestamp-unit'
  | 'timestamp-future'
  | 'respond-by'
  | 'body'
  | 'mentions'
  | 'message-type'

/**
 * One broken promise of the inbound shape contract.
 *
 * @category Contract checks
 */
export interface InboundViolation {
  rule: InboundRule
  /** Human-readable explanation. */
  message: string
  /** Index of the offending event in the checked array. */
  index: number
}

/**
 * Thrown by {@link assertInboundContract}; carries every violation found.
 *
 * @category Contract checks
 */
export class InboundContractError extends Error {
  readonly violations: InboundViolation[]
  constructor(violations: InboundViolation[]) {
    super(
      `Inbound contract violated (${violations.length} violation${violations.length === 1 ? '' : 's'}):\n` +
        violations.map((v) => `  - [${v.rule}] ${v.message}`).join('\n'),
    )
    this.name = 'InboundContractError'
    this.violations = violations
  }
}

const MESSAGE_TYPES: ReadonlySet<string> = new Set<MessageType>([
  'text', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contact',
  'poll', 'buttons', 'list', 'unknown', 'form',
])

const DAY_MS = 86_400_000

/**
 * Check normalized events against the inbound shape contract (epoch-ms timestamps,
 * message fields) and return every violation (empty array = conforming). Events without
 * a timestamp (connection, reaction, group, …) are skipped but keep their index.
 *
 * @category Contract checks
 */
export function checkInboundContract(
  events: ReadonlyArray<InboundContractInput>,
  options: InboundContractOptions = {},
): InboundViolation[] {
  const now = options.now ?? Date.now()
  const skew = options.maxFutureSkewMs ?? DAY_MS
  const min = options.minTimestamp ?? 1e12
  const out: InboundViolation[] = []

  const checkTime = (value: unknown, index: number, at: string, field = 'timestamp'): void => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      out.push({ rule: 'timestamp-missing', index, message: `${at}: ${field} is ${String(value)} (use the receive time, Date.now(), when the transport sends none)` })
    } else if (!Number.isInteger(value) || value < min) {
      out.push({ rule: 'timestamp-unit', index, message: `${at}: ${field} ${value} is not epoch milliseconds${value < min && value > 1e8 ? ' (looks like epoch seconds: multiply by 1000)' : ''}` })
    } else if (value > now + skew) {
      out.push({ rule: 'timestamp-future', index, message: `${at}: ${field} ${value} is ${Math.round((value - now) / 3_600_000)} h in the future` })
    }
  }

  events.forEach((input, index) => {
    const event = toEvent(input)
    if (!event) return
    if (event.kind === 'message') {
      const m = event.message
      const at = `event #${index} (message ${String(m.ref?.id)})`
      checkTime(m.timestamp, index, at)
      if (typeof m.body !== 'string') out.push({ rule: 'body', index, message: `${at}: body is ${typeof m.body}, expected a string ('' when there is none)` })
      if (!Array.isArray(m.mentions) || m.mentions.some((x) => typeof x !== 'string')) {
        out.push({ rule: 'mentions', index, message: `${at}: mentions must be an array of user ids` })
      }
      if (!MESSAGE_TYPES.has(m.type)) out.push({ rule: 'message-type', index, message: `${at}: type ${JSON.stringify(m.type)} is not a MessageType` })
    } else if (event.kind === 'interaction') {
      const it = event.interaction
      const at = `event #${index} (interaction ${String(it.interactionId)})`
      checkTime(it.timestamp, index, at)
      if (it.respondBy !== undefined) {
        const ok = typeof it.respondBy === 'number' && Number.isFinite(it.respondBy) && it.respondBy >= min &&
          (typeof it.timestamp !== 'number' || it.respondBy >= it.timestamp)
        if (!ok) out.push({ rule: 'respond-by', index, message: `${at}: respondBy ${String(it.respondBy)} must be epoch ms, not before the interaction's timestamp` })
      }
    } else if (event.kind === 'status') {
      checkTime(event.status.timestamp, index, `event #${index} (status ${String(event.status.ref?.id)})`)
    }
  })
  return out
}

/**
 * Throw an {@link InboundContractError} listing every violation unless the events satisfy
 * the inbound shape contract (see {@link checkInboundContract}).
 *
 * @throws {InboundContractError}
 *
 * @category Contract checks
 */
export function assertInboundContract(events: ReadonlyArray<InboundContractInput>, options: InboundContractOptions = {}): void {
  const violations = checkInboundContract(events, options)
  if (violations.length > 0) throw new InboundContractError(violations)
}

type Checked =
  | { kind: 'message'; message: InboundMessage }
  | { kind: 'interaction'; interaction: InboundInteraction }
  | Extract<InboundEvent, { kind: 'status' }>

function toEvent(input: unknown): Checked | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const rec = input as Record<string, unknown>
  if ('interactionId' in rec) return { kind: 'interaction', interaction: rec as unknown as InboundInteraction }
  if (rec.kind === 'message' || rec.kind === 'interaction' || rec.kind === 'status') return rec as unknown as Checked
  if ('kind' in rec) return undefined
  if ('ref' in rec && 'senderId' in rec) return { kind: 'message', message: rec as unknown as InboundMessage }
  return undefined
}
