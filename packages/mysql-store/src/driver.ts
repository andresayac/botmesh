/**
 * Lazy loader for the `mysql2` peer dependency. The store imports the driver only when it
 * creates its own pool (`start()` without an injected `pool`), so
 * importing the package never loads it and a missing driver fails with an install hint
 * instead of a bare `ERR_MODULE_NOT_FOUND`.
 */

/**
 * `await import(name)`, mapping "`name` is not installed" to an error that says how to fix
 * it (the original error is the `cause`). Any other failure is rethrown unchanged.
 */
export async function loadDriver<T = unknown>(name: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ name)) as T
  } catch (err) {
    const pkg = packageOf(name)
    if (!isNotFound(err, pkg) && !isNotFound(err, name)) throw err
    throw new Error(
      `@botmesh/mysql-store needs the MySQL driver "${pkg}", which is not installed. ` +
        `Install it (pnpm add ${pkg}) or pass an existing pool through the \`pool\` option.`,
      { cause: err },
    )
  }
}

/** The package a module specifier belongs to (`mysql2/promise` → `mysql2`). */
function packageOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/** True when `err` reports that `name` itself (not a transitive dependency) could not be resolved. */
function isNotFound(err: unknown, name: string): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
  return err.message.includes(`'${name}'`) || err.message.includes(`"${name}"`)
}

/** A pool configuration: a connection URI, or the discrete connection options (overriding the matching parts of `uri` when both are set). */
export type MysqlPoolConfig = string | { uri?: string; host?: string; port?: number; user?: string; password?: string; database?: string }

/** A new mysql2/promise pool (loads the driver on first use); connections open on first query. */
export async function createMysqlPool(config: MysqlPoolConfig): Promise<unknown> {
  type Mod = { createPool?: (config: MysqlPoolConfig) => unknown }
  const mod = await loadDriver<Mod & { default?: Mod }>('mysql2/promise')
  const createPool = mod.createPool ?? mod.default?.createPool
  if (typeof createPool !== 'function') throw new Error('@botmesh/mysql-store: the installed "mysql2" package exports no createPool')
  return createPool(config)
}
