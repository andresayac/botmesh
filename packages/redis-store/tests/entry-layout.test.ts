/**
 * Entry layout of `@botmesh/redis-store` (see docs/release-readiness.md): the main entry holds
 * the stores, the coordinator, the cluster client helpers, the `layout` option type and the
 * keyspace migration; the cluster key-layout internals live in `@botmesh/redis-store/internal`
 * (no semver). The runtime names of both entries are pinned so growing them is deliberate.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = [
  'RedisCoordinator', 'RedisDurability', 'RedisDurableKv', 'RedisLeaseProvider', 'RedisScheduleStore', 'RedisStore',
  'inspectKeyspace', 'isRedisClusterClient', 'migrateToClusterLayout', 'withClusterRetry',
] as const

/** Moved to `/internal`; kept on the main entry as `@deprecated` re-exports until the next major. */
const MAIN_DEPRECATED_VALUES = ['INDEX_BUCKETS', 'LAYOUT_MARKER', 'bucketOf', 'encodeSegment', 'hashSlot'] as const

const INTERNAL_VALUES = [
  'INDEX_BUCKETS', 'LAYOUT_MARKER', 'assertLayoutPrefix', 'assertOneSlot', 'bucketOf', 'coordKeys', 'encodeSegment',
  'hashSlot', 'hashTagOf', 'scheduleKeys', 'storeKeys', 'userDataKeys',
] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/redis-store entry layout', () => {
  it('the main entry exports exactly the application values (plus the deprecated re-exports)', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('/internal exports the cluster key-layout helpers', () => {
    expect(keysOf(internal)).toEqual([...INTERNAL_VALUES].sort())
  })

  it('the deprecated main-entry re-exports are the /internal values', () => {
    for (const name of MAIN_DEPRECATED_VALUES) expect(main[name], name).toBe(internal[name])
  })

  it('the deprecated re-exports carry @deprecated pointing at /internal', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    for (const name of MAIN_DEPRECATED_VALUES) {
      expect(src, name).toMatch(new RegExp(String.raw`@deprecated[^\n]*@botmesh/redis-store/internal[^\n]*\*/\s*\n\s*${name},`))
    }
  })

  it('package.json exposes ./internal next to the main entry', () => {
    const pj = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, unknown> }
    expect(pj.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
  })
})
