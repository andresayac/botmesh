/**
 * Config validation — runtime checks for the transport-agnostic BotConfig.
 *
 * WhatsApp/session fields (qr, pairingCode, sessionsDir, browser, …) moved to
 * @botmesh/baileys' BaileysProviderConfig and are validated there, not here.
 */

import type { BotConfig } from '../core/types.js'
import { parseDuration } from './duration.js'
import { parseTimerDuration } from './timers.js'

/** A short, never-throwing rendering of a rejected value (objects may be circular or huge). */
function describeValue(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) return String(value)
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/** A `BotConfig` option with an invalid value; `field` is the option's dotted path (`'durability.pollMs'`). */
export class ConfigValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly expected: string,
    public readonly received: unknown,
  ) {
    super(`Invalid config.${field}: expected ${expected}, got ${typeof received} (${describeValue(received)})`)
    this.name = 'ConfigValidationError'
  }
}

function assertType(field: string, value: unknown, type: string): void {
  if (value === undefined || value === null) return
  if (typeof value !== type) {
    throw new ConfigValidationError(field, type, value)
  }
}

/** What a duration option accepts, as the error states it. */
const DURATION = "a duration ('500ms', '30s', '10m', '1h') or milliseconds"

/**
 * A duration option: a string `parseDuration` reads or a number of ms. Range rules (minimums,
 * `0` meaning "off") stay with the module that owns the option; this only guarantees that a
 * typo fails at construction with an error naming the option.
 */
function assertDuration(field: string, value: unknown): void {
  if (value === undefined) return
  let ms = Number.NaN
  if (typeof value === 'number') ms = value
  else if (typeof value === 'string') {
    try { ms = parseDuration(value) } catch { /* reported below */ }
  }
  if (Number.isNaN(ms)) throw new ConfigValidationError(field, DURATION, value)
}

/** Reads `obj[key]` when `obj` is an object (a wrong-typed parent is reported by its own check). */
function at(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined
}

/**
 * Every duration option of `BotConfig` (every `*Ms` option among them) accepts a duration
 * string or ms; each is checked here so an invalid value names its option.
 */
function assertDurations(config: Partial<BotConfig>): void {
  const c = config as Record<string, unknown>
  assertDuration('conversation.timeout', at(c.conversation, 'timeout'))
  assertDuration('dedupe.ttl', at(c.dedupe, 'ttl'))
  assertDuration('echoFilter.ttl', at(c.echoFilter, 'ttl'))
  assertDuration('typing.minMs', at(c.typing, 'minMs'))
  assertDuration('typing.maxMs', at(c.typing, 'maxMs'))
  assertDuration('storeConfig.autoSaveInterval', at(c.storeConfig, 'autoSaveInterval'))
  const d = c.durability
  assertDuration('durability.pollMs', at(d, 'pollMs'))
  assertDuration('durability.retention', at(d, 'retention'))
  for (const side of ['inbox', 'outbox'] as const) {
    const s = at(d, side)
    assertDuration(`durability.${side}.leaseMs`, at(s, 'leaseMs'))
    const backoff = at(s, 'backoff')
    assertDuration(`durability.${side}.backoff.baseMs`, at(backoff, 'baseMs'))
    assertDuration(`durability.${side}.backoff.capMs`, at(backoff, 'capMs'))
  }
  assertDuration('durability.outbox.inlineMaxMs', at(at(d, 'outbox'), 'inlineMaxMs'))
  const co = c.coordination
  assertDuration('coordination.turnWaitMs', at(co, 'turnWaitMs'))
  assertDuration('coordination.settleMs', at(co, 'settleMs'))
  assertDuration('coordination.providerDownMs', at(co, 'providerDownMs'))
  assertDuration('coordination.handover.ttl', at(at(co, 'handover'), 'ttl'))
  assertDuration('scheduler.tickMs', at(c.scheduler, 'tickMs'))
  assertDuration('scheduler.leaderTtlMs', at(c.scheduler, 'leaderTtlMs'))
}

/**
 * Validate a BotConfig object at construction time. Throws
 * {@link ConfigValidationError} with a clear message on invalid input.
 */
export function validateConfig<T extends Partial<BotConfig>>(config: T): T {
  assertType('session', config.session, 'string')
  assertType('commandPrefix', config.commandPrefix, 'string')
  assertType('debug', config.debug, 'boolean')
  assertType('tenantId', config.tenantId, 'string')
  assertType('environmentId', config.environmentId, 'string')
  assertType('botId', config.botId, 'string')
  assertType('connectionId', config.connectionId, 'string')
  assertType('persistRaw', config.persistRaw, 'boolean')
  assertType('splitLongText', config.splitLongText, 'boolean')
  if (config.echoFilter !== undefined && config.echoFilter !== true) {
    if (typeof config.echoFilter !== 'object' || config.echoFilter === null) {
      throw new ConfigValidationError('echoFilter', 'true | { size?, ttl? }', config.echoFilter)
    }
  }

  assertDurations(config)
  if (config.lang !== undefined && (typeof config.lang !== 'string' || config.lang.trim() === '')) {
    throw new ConfigValidationError('lang', "a non-empty locale code (e.g. 'en', 'es')", config.lang)
  }
  if (config.lang !== undefined && config.i18n?.defaultLocale !== undefined
    && config.lang.trim().toLowerCase().replace(/_/g, '-') !== String(config.i18n.defaultLocale).trim().toLowerCase().replace(/_/g, '-')) {
    throw new ConfigValidationError('lang', `the same locale as i18n.defaultLocale (${String(config.i18n.defaultLocale)})`, config.lang)
  }

  if (config.commandPrefix === '') {
    throw new ConfigValidationError('commandPrefix', 'a non-empty string', '')
  }

  for (const field of ['tenantId', 'environmentId', 'botId', 'connectionId'] as const) {
    const value = config[field]
    if (value !== undefined && (value.trim() === '' || /[\u0000-\u001f]/.test(value))) {
      throw new ConfigValidationError(field, 'a non-empty string without control characters', value)
    }
  }

  if (config.conversationScope !== undefined) {
    if (config.conversationScope !== 'participant' && config.conversationScope !== 'chat') {
      throw new ConfigValidationError('conversationScope', "'participant' | 'chat'", config.conversationScope)
    }
  }

  if (config.groupMode !== undefined) {
    if (!['all', 'mentions', 'commands'].includes(config.groupMode)) {
      throw new ConfigValidationError('groupMode', "'all' | 'mentions' | 'commands'", config.groupMode)
    }
  }

  if (config.coordination !== undefined) {
    const c = config.coordination as unknown as Record<string, unknown> | null
    const coordinator = c?.coordinator as Record<string, unknown> | undefined
    if (typeof c !== 'object' || c === null || typeof coordinator !== 'object' || coordinator === null ||
        typeof coordinator.reserve !== 'function' || typeof coordinator.acquireTurn !== 'function' ||
        typeof coordinator.lead !== 'function') {
      throw new ConfigValidationError('coordination.coordinator', 'a Coordinator (e.g. new RedisCoordinator(...))', c?.coordinator)
    }
    if (c.providerSession !== undefined && !['leader', 'shared', 'auto'].includes(c.providerSession as string)) {
      throw new ConfigValidationError('coordination.providerSession', "'leader' | 'shared' | 'auto'", c.providerSession)
    }
    if (c.handover !== undefined) {
      const h = c.handover as Record<string, unknown> | null
      if (typeof h !== 'object' || h === null) throw new ConfigValidationError('coordination.handover', 'object', c.handover)
      if (h.flows !== undefined && h.flows !== 'forward' && h.flows !== 'drop') {
        throw new ConfigValidationError('coordination.handover.flows', "'forward' | 'drop'", h.flows)
      }
      if (h.fallback !== undefined && typeof h.fallback !== 'function' && !['notify', 'restart', 'drop'].includes(h.fallback as string)) {
        throw new ConfigValidationError('coordination.handover.fallback', "'notify' | 'restart' | 'drop' | function", h.fallback)
      }
      assertType('coordination.handover.notifyMessage', h.notifyMessage, 'string')
      if (h.maxAnswerBytes !== undefined && (typeof h.maxAnswerBytes !== 'number' || !(h.maxAnswerBytes >= 0))) {
        throw new ConfigValidationError('coordination.handover.maxAnswerBytes', 'number >= 0', h.maxAnswerBytes)
      }
    }
  }

  if (config.logIds !== undefined && !['hash', 'raw', 'omit'].includes(config.logIds as string)) {
    throw new ConfigValidationError('logIds', "'hash' | 'raw' | 'omit'", config.logIds)
  }

  if (config.rateLimitRetry !== undefined && config.rateLimitRetry !== false) {
    const r = config.rateLimitRetry as unknown
    if (typeof r !== 'object' || r === null || Array.isArray(r)) {
      throw new ConfigValidationError('rateLimitRetry', 'false | { retries?, maxWaitMs? }', r)
    }
    const { retries, maxWaitMs } = r as { retries?: unknown; maxWaitMs?: unknown }
    if (retries !== undefined && !(typeof retries === 'number' && Number.isInteger(retries) && retries >= 0)) {
      throw new ConfigValidationError('rateLimitRetry.retries', 'an integer >= 0', retries)
    }
    if (maxWaitMs !== undefined) {
      try {
        parseTimerDuration(maxWaitMs as string | number, 'rateLimitRetry.maxWaitMs')
      } catch {
        throw new ConfigValidationError('rateLimitRetry.maxWaitMs', "a duration (ms or '5s')", maxWaitMs)
      }
    }
  }

  if (config.rateLimit !== undefined && (typeof config.rateLimit !== 'object' || config.rateLimit === null)) {
    throw new ConfigValidationError('rateLimit', 'object', config.rateLimit)
  }

  if (config.telemetry !== undefined) {
    const t = config.telemetry as unknown as Record<string, unknown> | null
    const tracer = t?.tracer as Record<string, unknown> | undefined
    if (typeof t !== 'object' || t === null || typeof tracer !== 'object' || tracer === null || typeof tracer.startSpan !== 'function') {
      throw new ConfigValidationError('telemetry.tracer', 'a BotTracer (e.g. await createOtelTracer())', t?.tracer)
    }
    if (t.ids !== undefined && !['hash', 'raw', 'omit'].includes(t.ids as string)) {
      throw new ConfigValidationError('telemetry.ids', "'hash' | 'raw' | 'omit'", t.ids)
    }
    if (t.idKey !== undefined && typeof t.idKey !== 'string' && !(t.idKey instanceof Uint8Array)) {
      throw new ConfigValidationError('telemetry.idKey', 'string | Uint8Array', t.idKey)
    }
  }

  if (config.conversation) {
    assertType('conversation.timeoutMessage', config.conversation.timeoutMessage, 'string')
    assertType('conversation.retriesMessage', config.conversation.retriesMessage, 'string')
    assertType('conversation.errorMessage', config.conversation.errorMessage, 'string')
    assertType('conversation.cancelledMessage', config.conversation.cancelledMessage, 'string')
  }

  return config
}
