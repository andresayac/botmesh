/**
 * A small JSON Schema subset validator. The simulators check every request a
 * provider sends against the documented request shape of the platform (see
 * `specs.ts`): the schemas are written in this subset so fragments of the
 * official OpenAPI documents (twilio-oai, discord-api-spec) can be pasted in
 * with little or no change.
 */

export interface Schema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null' | Array<'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'>
  required?: string[]
  properties?: Record<string, Schema>
  /** `false` reports unknown properties. Default: allowed. */
  additionalProperties?: boolean | Schema
  items?: Schema
  enum?: readonly unknown[]
  const?: unknown
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  pattern?: string
  /** Exactly one must match. */
  oneOf?: Schema[]
  /** At least one must match. */
  anyOf?: Schema[]
  /** Free text for the report. */
  description?: string
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function typeMatches(expected: Schema['type'], value: unknown): boolean {
  if (expected === undefined) return true
  const actual = typeOf(value)
  const list = Array.isArray(expected) ? expected : [expected]
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'))
}

/** Validate `value`; returns a list of `path: problem` strings (empty when valid). */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const issues: string[] = []
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validate(s, value, path).length === 0).length
    if (matches !== 1) issues.push(`${path}: expected exactly one of ${schema.oneOf.length} shapes to match, ${matches} did`)
    return issues
  }
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s, value, path))
    if (!results.some((r) => r.length === 0)) {
      const best = results.reduce((a, b) => (b.length < a.length ? b : a))
      issues.push(...best)
    }
    return issues
  }
  if (!typeMatches(schema.type, value)) {
    issues.push(`${path}: expected ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}, got ${typeOf(value)}`)
    return issues
  }
  if (schema.const !== undefined && value !== schema.const) issues.push(`${path}: must be ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) issues.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`)
  if (typeof value === 'string') {
    // Length in code points, like the platforms count characters.
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) issues.push(`${path}: shorter than ${schema.minLength}`)
    if (schema.maxLength !== undefined && length > schema.maxLength) issues.push(`${path}: longer than ${schema.maxLength} (${length})`)
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) issues.push(`${path}: does not match /${schema.pattern}/`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path}: below ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${path}: above ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path}: fewer than ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path}: more than ${schema.maxItems} items (${value.length})`)
    if (schema.items) value.forEach((item, i) => issues.push(...validate(schema.items!, item, `${path}[${i}]`)))
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) issues.push(`${path}.${key}: required`)
    }
    for (const [key, child] of Object.entries(obj)) {
      if (child === undefined) continue
      const sub = schema.properties?.[key]
      if (sub) issues.push(...validate(sub, child, `${path}.${key}`))
      else if (schema.additionalProperties === false) issues.push(`${path}.${key}: unknown property`)
      else if (typeof schema.additionalProperties === 'object') issues.push(...validate(schema.additionalProperties, child, `${path}.${key}`))
    }
  }
  return issues
}
