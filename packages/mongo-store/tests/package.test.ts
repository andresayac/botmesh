/**
 * Packaging and entry layout of `@botmesh/mongo-store` (public since 1.0.0-beta).
 *
 * - The runtime names of the main entry are pinned, so growing it is deliberate.
 * - `mongodb` is a peer dependency, loaded lazily (`start()` of a store or backend that creates
 *   its own client): importing the package never loads it, and an injected client works without it.
 * - No published declaration imports `mongodb`: an injected client is typed structurally
 *   (`NativeMongoClient`), so consumers need no particular copy of the driver.
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

const MAIN_VALUES = ['MongoScheduleStore', 'MongoStore'] as const

describe('@botmesh/mongo-store entry layout', () => {
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
    expect(pkg.homepage).toBe('https://botmesh.afaya.com.co/guide/store')
  })

  it('declares mongodb as a peer dependency', () => {
    expect(pkg.peerDependencies?.mongodb).toBeDefined()
    expect(pkg.dependencies?.mongodb).toBeUndefined()
    expect(pkg.dependencies?.['@botmesh/core']).toBe('workspace:^')
  })

  it('never imports mongodb statically: the driver is loaded on first use', () => {
    const src = join(root, 'src')
    const offenders = readdirSync(src).filter((f) => /^\s*import\s+(?!type\b)[^;]*from\s+'mongodb(\/[^']*)?'/m.test(readFileSync(join(src, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('lazy driver loading', () => {
  it('a missing driver fails with an install hint naming the package', async () => {
    const err = await loadDriver('botmesh-missing-driver-xyz').then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/"botmesh-missing-driver-xyz"/)
    expect((err as Error).message).toMatch(/pnpm add botmesh-missing-driver-xyz/)
    expect((err as Error).message).toMatch(/`client`/)
    expect((err as Error).cause).toBeDefined()
  })

  it('loads the installed driver', async () => {
    const mod = await loadDriver<Record<string, unknown>>('mongodb')
    expect(typeof (mod.MongoClient ?? (mod.default as Record<string, unknown> | undefined)?.MongoClient)).toBe('function')
  })
})

const lib = join(root, 'lib')
describe.skipIf(!existsSync(join(lib, 'index.d.ts')))('published declarations', () => {
  it('never import mongodb from a file reachable from the entry point', () => {
    const seen = new Set<string>()
    const stack = [join(lib, 'index.d.ts')]
    while (stack.length) {
      const file = stack.pop()!
      if (seen.has(file) || !existsSync(file)) continue
      seen.add(file)
      for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)\.js'/g)) stack.push(join(dirname(file), `${m[1]}.d.ts`))
    }
    const offenders = [...seen].filter((f) => /from\s+'mongodb(\/[^']*)?'/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    expect(offenders.map((f) => f.slice(lib.length + 1))).toEqual([])
  })
})
