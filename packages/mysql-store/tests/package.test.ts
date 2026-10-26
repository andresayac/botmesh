/**
 * Packaging and entry layout of `@botmesh/mysql-store` (public since 1.0.0-beta).
 *
 * - The runtime names of the main entry are pinned, so growing it is deliberate.
 * - `mysql2` is a peer dependency, loaded lazily (`start()` of a store or backend that creates
 *   its own pool): importing the package never loads it, and an injected pool works without it.
 * - No published declaration imports `mysql2`: an injected pool is typed structurally
 *   (`NativeMysqlPool`), so consumers need no particular copy of the driver.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import { loadDriver } from '../src/driver.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  exports: Record<string, unknown>
  homepage?: string
  publishConfig?: { access?: string }
}

const MAIN_VALUES = ['MysqlScheduleStore', 'MysqlStore'] as const

describe('@botmesh/mysql-store entry layout', () => {
  it('the main entry exports exactly the store and the schedule store', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES])
  })

  it('package.json exposes only the main entry', () => {
    expect(Object.keys(pkg.exports)).toEqual(['.'])
  })
})

describe('package.json', () => {
  it('is public, with the docs page as homepage', () => {
    expect(pkg.private).toBeUndefined()
    expect(pkg.publishConfig?.access).toBe('public')
    expect(pkg.homepage).toBe('https://andresayac.github.io/botmesh/guide/store')
  })

  it('declares mysql2 as a peer dependency', () => {
    expect(pkg.peerDependencies?.mysql2).toBeDefined()
    expect(pkg.dependencies?.mysql2).toBeUndefined()
    expect(pkg.dependencies?.['@botmesh/core']).toBe('workspace:^')
  })

  it('never imports mysql2 statically: the driver is loaded on first use', () => {
    const src = join(root, 'src')
    const offenders = readdirSync(src).filter((f) => /^\s*import\s+(?!type\b)[^;]*from\s+'mysql2(\/[^']*)?'/m.test(readFileSync(join(src, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('lazy driver loading', () => {
  it('a missing driver fails with an install hint naming the package', async () => {
    const err = await loadDriver('botmesh-missing-driver-xyz').then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/"botmesh-missing-driver-xyz"/)
    expect((err as Error).message).toMatch(/pnpm add botmesh-missing-driver-xyz/)
    expect((err as Error).message).toMatch(/`pool`/)
    expect((err as Error).cause).toBeDefined()
  })

  it('a missing driver imported by subpath names the package to install', async () => {
    const err = await loadDriver('botmesh-missing-driver-xyz/promise').then(() => undefined, (e: unknown) => e)
    expect((err as Error).message).toMatch(/pnpm add botmesh-missing-driver-xyz\)/)
  })

  it('loads the installed driver', async () => {
    const mod = await loadDriver<Record<string, unknown>>('mysql2/promise')
    expect(typeof (mod.createPool ?? (mod.default as Record<string, unknown> | undefined)?.createPool)).toBe('function')
  })
})

const lib = join(root, 'lib')
describe.skipIf(!existsSync(join(lib, 'index.d.ts')))('published declarations', () => {
  it('never import mysql2 from a file reachable from the entry point', () => {
    const seen = new Set<string>()
    const stack = [join(lib, 'index.d.ts')]
    while (stack.length) {
      const file = stack.pop()!
      if (seen.has(file) || !existsSync(file)) continue
      seen.add(file)
      for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)\.js'/g)) stack.push(join(dirname(file), `${m[1]}.d.ts`))
    }
    const offenders = [...seen].filter((f) => /from\s+'mysql2(\/[^']*)?'/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    expect(offenders.map((f) => f.slice(lib.length + 1))).toEqual([])
  })
})
