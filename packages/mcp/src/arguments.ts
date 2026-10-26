/**
 * Checks `tools/call` arguments against the tool's advertised `inputSchema`, so the schema a
 * client sees is the contract the server enforces: unknown keys, missing required keys,
 * wrong types, values outside an `enum` or a numeric range, and absurdly deep values fail
 * with one actionable sentence instead of being ignored or overflowing the stack later.
 *
 * Only the subset of JSON Schema the catalogue uses is understood (`type` object / string /
 * integer, `enum`, `minimum`, `maximum`, `minLength`, `required`, `additionalProperties:
 * false`); the flow documents themselves are validated by `@botmesh/flow-schema`.
 */

/**
 * Deepest nesting accepted in one argument value. A valid flow document stays far below it
 * (the schema allows 8 levels of nested steps); anything deeper is refused before any
 * recursive code (validation, compilation, serialization) can run out of stack.
 */
export const MAX_ARGUMENT_DEPTH = 64

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** `true` when `value` nests more than `limit` objects/arrays deep (stops at the limit). */
function deeperThan(value: unknown, limit: number): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (limit <= 0) return true
  for (const child of Object.values(value)) if (deeperThan(child, limit - 1)) return true
  return false
}

const quoteList = (values: readonly unknown[]): string => values.map((value) => JSON.stringify(value)).join(', ')

function checkValue(name: string, schema: Record<string, unknown>, value: unknown): string | undefined {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `"${name}" must be one of ${quoteList(schema.enum)}`
  }
  switch (schema.type) {
    case 'object':
      if (record(value) === undefined) return `"${name}" must be an object`
      break
    case 'string': {
      if (typeof value !== 'string') return `"${name}" must be a string`
      const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0
      if (value.trim().length < minLength) return minLength === 1 ? `"${name}" must be a non-empty string` : `"${name}" must have at least ${minLength} characters`
      break
    }
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `"${name}" must be an integer`
      if (typeof schema.minimum === 'number' && value < schema.minimum) return `"${name}" must be at least ${schema.minimum}`
      if (typeof schema.maximum === 'number' && value > schema.maximum) return `"${name}" must be at most ${schema.maximum}`
      break
    default:
      break
  }
  if (deeperThan(value, MAX_ARGUMENT_DEPTH)) return `"${name}" is nested deeper than ${MAX_ARGUMENT_DEPTH} levels`
  return undefined
}

/** The first problem of `args` against `schema`, or `undefined` when they match. */
export function checkArguments(schema: Record<string, unknown>, args: Record<string, unknown>): string | undefined {
  const properties = record(schema.properties) ?? {}
  if (schema.additionalProperties === false) {
    const accepted = Object.keys(properties)
    for (const key of Object.keys(args)) {
      if (!Object.hasOwn(properties, key)) {
        return `unknown argument "${key}" (accepted: ${accepted.length > 0 ? quoteList(accepted) : 'none'})`
      }
    }
  }
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : []
  for (const key of required) {
    if (typeof key === 'string' && args[key] === undefined) return `missing required argument "${key}"`
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue
    const property = Object.hasOwn(properties, key) ? record(properties[key]) : undefined
    const problem = property ? checkValue(key, property, value) : deeperThan(value, MAX_ARGUMENT_DEPTH) ? `"${key}" is nested deeper than ${MAX_ARGUMENT_DEPTH} levels` : undefined
    if (problem !== undefined) return problem
  }
  return undefined
}
