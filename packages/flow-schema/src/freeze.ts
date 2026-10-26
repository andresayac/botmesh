/**
 * Deep freeze for exported data (the JSON Schema, the migration table): a consumer that
 * mutates a shared constant would otherwise change the behaviour of every flow in the process.
 */

/** Freeze `value` and every object or array reachable from it; returns the same reference. */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
