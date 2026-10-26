/**
 * Deep freeze for the data `@botmesh/ai` exports (vocabularies, message keys, built-in
 * texts, presets), so a user cannot change the plugin's defaults for every bot in the
 * process by mutating a shared export.
 */

/** Recursively `Object.freeze` an object or array literal and return it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
