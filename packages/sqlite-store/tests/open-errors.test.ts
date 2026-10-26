/** Actionable errors when the database cannot be opened. */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SQLiteStore } from '../src/SQLiteStore.js'
import { openError } from '../src/openError.js'

describe('SQLiteStore open errors', () => {
  it('names the file and the fix when its directory does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botwa-sqlite-open-'))
    try {
      const file = join(dir, 'missing', 'bot.db')
      let error: unknown
      try { new SQLiteStore({ file }) } catch (e) { error = e }
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(file)
      expect((error as Error).message).toMatch(/directory does not exist/)
      expect((error as Error).message).toMatch(/create/i)
      expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(Error)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('names the file when it is not a SQLite database, keeps the SQLite code and releases the handle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botwa-sqlite-open-'))
    const file = join(dir, 'garbage.db')
    try {
      writeFileSync(file, 'not a database '.repeat(40))
      let error: unknown
      try { new SQLiteStore({ file }) } catch (e) { error = e }
      expect((error as Error).message).toContain(file)
      expect((error as Error).message).toMatch(/not a database/)
      expect((error as Error & { code?: string }).code).toBe('SQLITE_NOTADB')
    } finally {
      // The failed open must not keep the file open (Windows would refuse to delete it).
      rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 20 })
    }
    expect(existsSync(file)).toBe(false)
  })

  it('explains a native module that was never built with better-sqlite3 13 (no prebuild, no build)', () => {
    // v13 loads prebuilds/<platform>.node, then falls back to build/Release, and reports MODULE_NOT_FOUND.
    const native = Object.assign(
      new Error("Cannot find module '/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\nRequire stack:\n- /app/node_modules/better-sqlite3/lib/binding.js"),
      { code: 'MODULE_NOT_FOUND' },
    )
    const err = openError(native, './bot.db')
    expect(err.message.split('\n')).toHaveLength(1)
    expect(err.message).toMatch(/native module was never built/)
    expect(err.message).toMatch(/pnpm approve-builds/)
    expect(err.message).not.toContain('Require stack')
    expect(err.cause).toBe(native)
  })

  it('does not mistake an unrelated missing module for an unbuilt native module', () => {
    const err = openError(Object.assign(new Error("Cannot find module 'left-pad'"), { code: 'MODULE_NOT_FOUND' }), './bot.db')
    expect(err.message).not.toMatch(/never built/)
  })

  it('explains a native module that was never built (pnpm skips build scripts by default)', () => {
    const native = new Error(['Could not locate the bindings file. Tried:', ' → /x/build/better_sqlite3.node', ' → /x/build/Release/better_sqlite3.node'].join('\n'))
    const err = openError(native, './bot.db')
    expect(err.message.split('\n')).toHaveLength(1)
    expect(err.message).toMatch(/native module/)
    expect(err.message).toMatch(/pnpm approve-builds/)
    // pnpm 11 replaced onlyBuiltDependencies with the allowBuilds map; name both.
    expect(err.message).toMatch(/allowBuilds: \{ better-sqlite3: true \}/)
    expect(err.message).toMatch(/pnpm 11/)
    expect(err.message).toMatch(/onlyBuiltDependencies: \[better-sqlite3\]/)
    expect(err.message).not.toContain('Tried:')
    expect(err.cause).toBe(native)
  })

  it('explains a native module built for another Node.js version', () => {
    const native = new Error('The module /x/better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.')
    const err = openError(native, './bot.db')
    expect(err.message).toMatch(/rebuild better-sqlite3/)
    expect(err.cause).toBe(native)
  })

  it('passes any other error through untouched', () => {
    const other = new Error('SQLITE_CANTOPEN: unable to open database file')
    const err = openError(other, './bot.db')
    expect(err.message).toContain('./bot.db')
    expect(err.message).toContain('SQLITE_CANTOPEN')
    expect(err.cause).toBe(other)
  })
})
