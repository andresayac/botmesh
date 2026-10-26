/**
 * A small JSON Schema subset validator. The simulators check every request a
 * provider sends against the documented request shape of the platform: the
 * hand-written schemas use this subset, and so do the fragments vendored from
 * the official OpenAPI documents (twilio-oai, discord-api-spec) in
 * `src/specs/` (`$ref` into `$defs`, `allOf`, `uniqueItems`; `format` is an
 * annotation and is not checked).
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
  /** All must match. */
  allOf?: Schema[]
  /** Items must be distinct (compared as JSON). */
  uniqueItems?: boolean
  /** Annotation only (not checked). */
  format?: string
  /** `#/$defs/<name>`, resolved against the root schema's `$defs`. */
  $ref?: string
  /** Definitions `$ref` can point at (only read on the root schema). */
  $defs?: Record<string, Schema>
  /** Free text for the report. */
  description?: string
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function typesOf(schema: Schema | undefined): string[] {
  if (schema?.type === undefined) return []
  return Array.isArray(schema.type) ? schema.type : [schema.type]
}

function typeMatches(expected: Schema['type'], value: unknown): boolean {
  if (expected === undefined) return true
  const actual = typeOf(value)
  const list = Array.isArray(expected) ? expected : [expected]
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'))
}

const patternCache = new Map<string, RegExp | null>()

/** Compile a pattern with the u flag, falling back to legacy mode (OpenAPI patterns are not always u-safe). */
function compilePattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern)
  if (cached !== undefined) return cached
  let re: RegExp | null
  try { re = new RegExp(pattern, 'u') } catch {
    try { re = new RegExp(pattern) } catch { re = null }
  }
  patternCache.set(pattern, re)
  return re
}

function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map && Object.hasOwn(map, key) ? map[key] : undefined
}

/**
 * A form body (`application/x-www-form-urlencoded`) as an object typed after
 * `schema`: repeated fields declared as arrays become arrays, numeric and
 * boolean fields are converted when the text is a valid value (otherwise the
 * string is kept, so the validator reports it).
 */
export function formToObject(form: URLSearchParams, schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of new Set(form.keys())) {
    const prop = own(schema.properties, key)
    const values = form.getAll(key)
    out[key] = typesOf(prop).includes('array') ? values.map((v) => coerce(v, prop!.items)) : coerce(values[values.length - 1]!, prop)
  }
  return out
}

function coerce(text: string, schema: Schema | undefined): unknown {
  const types = typesOf(schema)
  if ((types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text)
    if (types.includes('number') || Number.isInteger(n)) return n
  }
  if (types.includes('boolean') && (text === 'true' || text === 'false')) return text === 'true'
  return text
}

/** Validate `value`; returns a list of `path: problem` strings (empty when valid). */
export function validate(schema: Schema, value: unknown, path = '$', root: Schema = schema): string[] {
  const issues: string[] = []
  if (schema.$ref !== undefined) {
    const target = schema.$ref.startsWith('#/$defs/') ? own(root.$defs, schema.$ref.slice('#/$defs/'.length)) : undefined
    if (!target) return [`${path}: unresolvable $ref ${schema.$ref}`]
    issues.push(...validate(target, value, path, root))
  }
  if (schema.allOf) for (const s of schema.allOf) issues.push(...validate(s, value, path, root))
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validate(s, value, path, root).length === 0).length
    if (matches !== 1) issues.push(`${path}: expected exactly one of ${schema.oneOf.length} shapes to match, ${matches} did`)
  }
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s, value, path, root))
    if (!results.some((r) => r.length === 0)) {
      const best = results.reduce((a, b) => (b.length < a.length ? b : a))
      issues.push(...best)
    }
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
    if (schema.pattern) {
      const re = compilePattern(schema.pattern)
      if (!re) issues.push(`${path}: invalid pattern /${schema.pattern}/`)
      else if (!re.test(value)) issues.push(`${path}: does not match /${schema.pattern}/`)
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path}: below ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${path}: above ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path}: fewer than ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path}: more than ${schema.maxItems} items (${value.length})`)
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) issues.push(`${path}: items are not unique`)
    if (schema.items) value.forEach((item, i) => issues.push(...validate(schema.items!, item, `${path}[${i}]`, root)))
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(obj, key) || obj[key] === undefined) issues.push(`${path}.${key}: required`)
    }
    for (const [key, child] of Object.entries(obj)) {
      if (child === undefined) continue
      const sub = own(schema.properties, key)
      if (sub) issues.push(...validate(sub, child, `${path}.${key}`, root))
      else if (schema.additionalProperties === false) issues.push(`${path}.${key}: unknown property`)
      else if (typeof schema.additionalProperties === 'object') issues.push(...validate(schema.additionalProperties, child, `${path}.${key}`, root))
    }
  }
  return issues
}
