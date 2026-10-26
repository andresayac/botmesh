/**
 * Lazy loader for the `pg` peer dependency. The store and the durability backend import the
 * driver only when they create their own pool (`start()` without an injected `pool`), so
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
      `@botmesh/postgres-store needs the PostgreSQL driver "${pkg}", which is not installed. ` +
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

/** The slice of node-postgres the package uses: the `Pool` constructor. */
export interface PgModule {
  Pool: new (config: { connectionString: string }) => PgPool
}

/** The slice of a node-postgres `Pool` the package uses for a pool it creates. */
export interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>
  end(): Promise<void>
  on(event: 'error', listener: (err: Error) => void): unknown
}

/** A new node-postgres `Pool` for `connectionString` (loads the driver on first use). */
export async function createPgPool(connectionString: string): Promise<PgPool> {
  const mod = await loadDriver<Partial<PgModule> & { default?: Partial<PgModule> }>('pg')
  const Pool = mod.Pool ?? mod.default?.Pool
  if (typeof Pool !== 'function') throw new Error('@botmesh/postgres-store: the installed "pg" package exports no Pool')
  return new Pool({ connectionString })
}
