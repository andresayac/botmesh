/**
 * `tablePrefix` validation shared by the store, the schedule store and the durability
 * backend. The prefix is interpolated into SQL identifiers, so only plain identifier
 * characters are allowed, and its length is capped: PostgreSQL silently truncates an
 * identifier to 63 bytes, and a long prefix made distinct names collide (`…_chats` and
 * `…_checkpoints` both became `…_ch`, so `CREATE TABLE IF NOT EXISTS` skipped the second
 * table and two kinds of record shared one table).
 */

const TABLE_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** PostgreSQL's identifier limit (NAMEDATALEN - 1), in bytes. */
const MAX_IDENTIFIER = 63

/** The longest name this package appends to a prefix: `user_data_expires_idx`. */
const LONGEST_SUFFIX = 'user_data_expires_idx'.length

/**
 * Longest accepted `tablePrefix` (42): every table and index of the store, the schedule
 * store and the durability backend then fits in 63 bytes, so one prefix works for all three.
 */
export const MAX_TABLE_PREFIX_LENGTH = MAX_IDENTIFIER - LONGEST_SUFFIX

/**
 * Validates `prefix` (`''` is the default and always valid). Throws an `Error` for
 * characters outside `[A-Za-z0-9_]` (or a leading digit) and a `RangeError` for a prefix
 * longer than {@link MAX_TABLE_PREFIX_LENGTH}.
 */
export function assertTablePrefix(owner: string, prefix: string): void {
  if (prefix === '') return
  if (!TABLE_PREFIX_RE.test(prefix)) {
    throw new Error(
      `${owner}: invalid tablePrefix ${JSON.stringify(prefix)} — use a plain SQL identifier prefix (letters, digits, underscores, e.g. 'mybot_')`,
    )
  }
  if (prefix.length > MAX_TABLE_PREFIX_LENGTH) {
    throw new RangeError(
      `${owner}: tablePrefix ${JSON.stringify(prefix)} is ${prefix.length} characters long; use at most ${MAX_TABLE_PREFIX_LENGTH}, ` +
        'because PostgreSQL truncates table and index names to 63 bytes and longer prefixes make them collide',
    )
  }
}
