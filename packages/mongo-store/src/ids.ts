/**
 * Id guard shared by MongoStore, its `ctx.user` collection and MongoScheduleStore.
 */

/**
 * An id about to enter a MongoDB filter. Only a string may: an object such as
 * `{ $ne: '' }` (untrusted JSON forwarded by an app) is a query operator to MongoDB, and
 * would read, overwrite or delete other chats' and users' documents. The SQL stores bind
 * every value as text, so they need no such check.
 */
export function idString(value: unknown, what: string, owner = 'MongoStore'): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${owner}: ${what} must be a string, got ${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}`)
  }
  return value
}
