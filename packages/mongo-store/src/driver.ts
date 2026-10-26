/**
 * Lazy loading of the `mongodb` peer dependency. A store that creates its own client
 * (`url`, no injected `client`) gets a {@link LazyMongoClient}: the driver is imported and
 * the real `MongoClient` built on `start()`, so importing the package never loads it and a
 * missing driver fails with an install hint instead of a bare `ERR_MODULE_NOT_FOUND`.
 */

import type { MongoLikeClient, MongoLikeCollection, MongoLikeDb, MongoLikeSession } from './MongoStore.js'

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
      `@botmesh/mongo-store needs the MongoDB driver "${pkg}", which is not installed. ` +
        `Install it (pnpm add ${pkg}) or pass an existing client through the \`client\` option.`,
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

/** A new, unconnected `MongoClient` for `url` (loads the driver on first use). */
async function createMongoClient(url: string): Promise<MongoLikeClient> {
  type Mod = { MongoClient?: new (url: string) => unknown }
  const mod = await loadDriver<Mod & { default?: Mod }>('mongodb')
  const MongoClient = mod.MongoClient ?? mod.default?.MongoClient
  if (typeof MongoClient !== 'function') throw new Error('@botmesh/mongo-store: the installed "mongodb" package exports no MongoClient')
  // The driver's generic command signatures aren't directly assignable to the plain
  // structural interfaces; the command subset used here matches at runtime.
  return new MongoClient(url) as MongoLikeClient
}

/**
 * The client of a store that owns it. `connect()` (called by `MongoStore.start()`) loads the
 * driver and builds the real client; before that, a collection call fails with a "not
 * started" error, and after `close()` (`MongoStore.stop()`) with a "stopped" one. Collections
 * handed out earlier (the store's own, `store.schedules()`) resolve to the real ones on their
 * first call and work again after the next `connect()`.
 */
export class LazyMongoClient implements MongoLikeClient {
  private real?: MongoLikeClient
  private opening?: Promise<MongoLikeClient>
  private closed = false

  constructor(private readonly url: string) {}

  /** The real client, or a store error when the store is not (or no longer) started. */
  private live(): MongoLikeClient {
    if (!this.real) throw new Error('MongoStore is not started — call start() before using it')
    if (this.closed) throw new Error('MongoStore is stopped — call start() before using it')
    return this.real
  }

  async connect(): Promise<unknown> {
    this.real ??= await (this.opening ??= createMongoClient(this.url).finally(() => { this.opening = undefined }))
    const connected = await this.real.connect()
    this.closed = false
    return connected
  }

  async close(force?: boolean): Promise<void> {
    if (!this.real) return
    this.closed = true
    await this.real.close(force)
  }

  startSession(): MongoLikeSession {
    const real = this.live()
    if (typeof real.startSession !== 'function') throw new Error('MongoStore: the driver client has no startSession()')
    return real.startSession()
  }

  db(name?: string): MongoLikeDb {
    return {
      collection: <T extends { _id: string }>(n: string) =>
        lazyCollection(() => this.live().db(name).collection<T>(n), () => { this.live() }),
    }
  }
}

/**
 * A collection whose methods forward to `resolve()`'s result. Every property is a method
 * that resolves the real collection on call (then cached: a driver `Collection` stays bound
 * to its client across close/connect), so handing it out and checking its shape (what
 * `MongoScheduleStore` does) never needs the client. `check()` runs before every call, so a
 * stopped store fails with its own error. Not thenable.
 */
function lazyCollection<T extends { _id: string }>(resolve: () => MongoLikeCollection<T>, check: () => void): MongoLikeCollection<T> {
  let target: Record<PropertyKey, (...a: unknown[]) => unknown> | undefined
  return new Proxy({} as MongoLikeCollection<T>, {
    get(_obj, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      return (...args: unknown[]) => {
        check()
        target ??= resolve() as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>
        return target[prop]!(...args)
      }
    },
  })
}
