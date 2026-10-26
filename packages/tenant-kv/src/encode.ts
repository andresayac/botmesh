/**
 * Table-name segments. A tenant id (or any caller-provided segment) is percent-encoded
 * before it becomes part of a `DurableKv` table name, so it can never contain the `/`
 * separator, a Redis hash-tag brace or a glob character: `a/b`, `}{` and `*` are all
 * harmless. The alphabet is the same as `@botmesh/redis-store`'s `encodeSegment`.
 */

/** Percent-encode one segment (`encodeURIComponent` plus `!'()*~`). */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `true` for a non-empty string. */
export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** @throws {TypeError} unless `value` is a non-empty string. */
export function assertTenantId(value: unknown, what = 'tenantId'): asserts value is string {
  if (!isTenantId(value)) throw new TypeError(`${what} must be a non-empty string`)
}

/**
 * @throws {TypeError} unless `value` is a non-empty string without NUL characters (a
 * document id is stored as is, and PostgreSQL `TEXT` cannot hold NUL).
 */
export function assertDocId(value: unknown, what = 'document id'): asserts value is string {
  if (typeof value !== 'string' || value === '' || value.includes('\u0000')) {
    throw new TypeError(`${what} must be a non-empty string without NUL characters`)
  }
}
