/**
 * Fail-fast validation of `aiPlugin(config)`: a mistyped number (`Number(process.env.X)`
 * when the variable is unset gives `NaN`) would otherwise surface much later as a
 * confusing behaviour — a `NaN` or oversized timeout fires after 1 ms, a `NaN` history
 * window never trims, a `NaN` `maxSteps` never calls the model. Each check throws a
 * `RangeError` / `TypeError` naming the option, when the config is built.
 */

import { parseDuration } from '@botmesh/core'
import type { AIPluginConfig } from './plugin.js'

/** Largest delay a Node timer honours (about 24.8 days); above it the timer fires after 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1

function show(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

/** A timeout in ms: any finite number up to the timer limit (`<= 0` disables it, as documented). */
function timeoutMs(name: string, v: unknown): void {
  if (v === undefined) return
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new RangeError(`aiPlugin: ${name} must be a finite number of milliseconds (0 disables it), got ${show(v)}`)
  }
  if (v > MAX_TIMER_MS) {
    throw new RangeError(`aiPlugin: ${name} supports at most ${MAX_TIMER_MS} ms (about 24 days), got ${v}`)
  }
}

function integer(name: string, v: unknown, min: number): void {
  if (v === undefined) return
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) {
    throw new RangeError(`aiPlugin: ${name} must be an integer >= ${min}, got ${show(v)}`)
  }
}

/** Throw on a configuration that cannot work (see the module doc). */
export function assertAIConfig(cfg: AIPluginConfig): void {
  timeoutMs('timeoutMs', cfg.timeoutMs)
  timeoutMs('toolTimeoutMs', cfg.toolTimeoutMs)
  integer('maxTokens', cfg.maxTokens, 1)
  integer('context.maxMessages', cfg.context?.maxMessages, 0)
  if (cfg.maxTokensField !== undefined && cfg.maxTokensField !== 'max_tokens' && cfg.maxTokensField !== 'max_completion_tokens') {
    throw new RangeError(`aiPlugin: maxTokensField must be 'max_tokens' or 'max_completion_tokens', got ${show(cfg.maxTokensField)}`)
  }
  if (cfg.memory && typeof cfg.memory === 'object') {
    integer('memory.maxFacts', cfg.memory.maxFacts, 1)
    integer('memory.maxFactLength', cfg.memory.maxFactLength, 1)
    const ttl = cfg.memory.ttl
    if (ttl !== undefined) {
      let ms: number
      try { ms = parseDuration(ttl) } catch (err) {
        throw new RangeError(`aiPlugin: memory.ttl ${show(ttl)} is not a duration (use '30d', '12h' or ms): ${err instanceof Error ? err.message : String(err)}`)
      }
      if (!Number.isFinite(ms) || ms <= 0) throw new RangeError(`aiPlugin: memory.ttl must be a positive duration, got ${show(ttl)}`)
    }
  }
  // `maxSteps` below 1 has always meant 1: only a value that is not a number at all is rejected.
  if (cfg.maxSteps !== undefined && (typeof cfg.maxSteps !== 'number' || !Number.isFinite(cfg.maxSteps))) {
    throw new RangeError(`aiPlugin: maxSteps must be a positive integer, got ${show(cfg.maxSteps)}`)
  }
  // A bad confirmation timeout would only fail inside the confirmation, which then ends
  // silently (the turn is cancelled): every `confirm: true` tool would just never run.
  const confirmTimeout = cfg.toolConfirm?.timeout
  if (confirmTimeout !== undefined) {
    let ms: number
    try { ms = parseDuration(confirmTimeout) } catch (err) {
      throw new RangeError(`aiPlugin: toolConfirm.timeout ${show(confirmTimeout)} is not a duration (use '2m', '90s' or ms): ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_MS) {
      throw new RangeError(`aiPlugin: toolConfirm.timeout must be a duration between 0 (no timeout) and ${MAX_TIMER_MS} ms, got ${show(confirmTimeout)}`)
    }
  }
  const rag = cfg.rag as { retrieve?: unknown; timeoutMs?: unknown } | undefined
  if (rag && typeof rag.retrieve !== 'function') timeoutMs('rag.timeoutMs', rag.timeoutMs)
  for (const [name, tool] of Object.entries(cfg.tools ?? {})) {
    if (!tool || typeof tool.handler !== 'function') {
      throw new TypeError(`aiPlugin: tools.${name} needs a handler function`)
    }
    timeoutMs(`tools.${name}.timeoutMs`, tool.timeoutMs)
    const dedupe = tool.dedupe as unknown
    if (dedupe && dedupe !== 'args') {
      const windowMs = (dedupe as { windowMs?: unknown } | null)?.windowMs
      if (typeof windowMs !== 'number' || !Number.isFinite(windowMs)) {
        throw new RangeError(`aiPlugin: tools.${name}.dedupe.windowMs must be a finite number of milliseconds (or use dedupe: 'args'), got ${show(windowMs)}`)
      }
    }
  }
}
