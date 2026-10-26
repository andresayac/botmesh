/**
 * Turns the errors of opening a better-sqlite3 database into actionable ones (internal).
 *
 * The usual first-run failures are not about SQLite at all: the native module was never
 * built (pnpm >= 10 skips dependency build scripts unless approved) or was built for
 * another Node.js version, and better-sqlite3 then reports a dozen probed paths. A missing
 * parent directory does not name the file. The original error stays as `cause`.
 */

/** A one-line, actionable error for a failed `new Database(file)`; keeps the SQLite `code`. */
export function openError(err: unknown, file: string): Error {
  const error = describe(err, file)
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string') Object.assign(error, { code })
  return error
}

function describe(err: unknown, file: string): Error {
  const message = err instanceof Error ? err.message : String(err)
  const first = message.split('\n', 1)[0]!.trim()
  // better-sqlite3 <= 12 probes paths via `bindings`; 13 falls back to build/Release and
  // throws MODULE_NOT_FOUND for better_sqlite3.node when there is no prebuild for the platform.
  if (/could not locate the bindings file/i.test(message) || /cannot find module .*better_sqlite3\.node/i.test(first)) {
    return new Error(
      'SQLiteStore: better-sqlite3 is installed but its native module was never built ' +
        `(${first.replace(/\s*Tried:$/, '')}). With pnpm >= 10, allow its build script ` +
        '(`pnpm approve-builds`, or `onlyBuiltDependencies: [better-sqlite3]` in pnpm-workspace.yaml) and reinstall; ' +
        'with npm, check that `npm install` did not run with --ignore-scripts.',
      { cause: err },
    )
  }
  if (/NODE_MODULE_VERSION|compiled against a different Node\.js version/.test(message)) {
    return new Error(
      'SQLiteStore: the better-sqlite3 native module was built for another Node.js version. ' +
        'Run `npm rebuild better-sqlite3` (or `pnpm rebuild better-sqlite3`) with the Node.js that runs the bot.',
      { cause: err },
    )
  }
  if (/directory does not exist/i.test(message)) {
    return new Error(
      `SQLiteStore: cannot open "${file}" because its directory does not exist; create it first ` +
        "(e.g. mkdirSync(dirname(file), { recursive: true })). SQLite creates the file, not its folders.",
      { cause: err },
    )
  }
  return new Error(`SQLiteStore: cannot open "${file}": ${first}`, { cause: err })
}
