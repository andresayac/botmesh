/**
 * Config checks shared by the client, the context and the plugin: a mistyped option fails at
 * `bot.plug()` with a `DialogflowError` (`code: 'INVALID_CONFIG'`) instead of silently never routing.
 */

import { DialogflowError } from './auth.js'

/** Throw an `INVALID_CONFIG` error. */
export function invalidConfig(message: string): never {
  throw new DialogflowError(message, undefined, 'INVALID_CONFIG')
}

/** `minConfidence` is a probability: `0.8`, not `80`. */
export function checkConfidence(value: unknown, name = 'minConfidence'): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalidConfig(`${name} must be a number between 0 and 1 (e.g. 0.6), got ${String(value)}`)
  }
}

/** A Google region id such as `us-central1`, `europe-west1` or `global`. */
const LOCATION = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function checkLocation(value: unknown, name: string): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !LOCATION.test(value)) {
    invalidConfig(`${name} must be a region id such as 'us-central1', 'europe-west1' or 'global', got ${JSON.stringify(value)}`)
  }
}

/** Check that `value` is one of `allowed` (when set). */
export function checkOneOf(value: unknown, allowed: readonly string[], name: string): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !allowed.includes(value)) {
    const list = allowed.map((a) => `'${a}'`)
    invalidConfig(`${name} must be ${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}, got ${JSON.stringify(value)}`)
  }
}
