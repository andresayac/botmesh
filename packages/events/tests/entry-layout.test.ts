/**
 * Entry layout of `@botmesh/events`: the main entry holds envelopes, journals, the worker and
 * their errors (no `@botmesh/core` needed); `@botmesh/events/durability` holds the bot durability
 * backend (needs `@botmesh/core`). Test seams are not exported. The runtime names of both
 * entries are pinned so growing them is deliberate.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import * as main from '../src/index.js'
import * as durability from '../src/durability.js'

const MAIN_VALUES = [
  'EventNotFoundError', 'EventWorker', 'FileEventJournal', 'MemoryEventJournal', 'SharedFileEventJournal',
  'StaleLeaseError', 'createEnvelope', 'exponentialBackoff',
] as const

const DURABILITY_VALUES = ['EventsDurability', 'eventsDurability'] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/events entry layout', () => {
  it('the main entry exports exactly the application values (no test seams)', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES].sort())
  })

  it('/durability exports the backend', () => {
    expect(keysOf(durability)).toEqual([...DURABILITY_VALUES].sort())
  })

  it('the main entry does not import @botmesh/core', () => {
    for (const file of ['../src/index.ts', '../src/journal.ts', '../src/fileLog.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src, file).not.toMatch(/from\s+['"]@botmesh\/core/)
    }
  })

  it('EventsDurability can only be built through eventsDurability() (private constructor, not @internal)', () => {
    // `@internal` is stripped from the published .d.ts, which would leave an implicit public
    // zero-argument constructor that crashes at runtime; a `private constructor` survives the strip.
    const src = readFileSync(new URL('../src/durability.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/private constructor\(/)
    expect(src).not.toMatch(/@internal[^\n]*\n\s*(?:private )?constructor\(/)
    // @ts-expect-error the constructor is private: use eventsDurability()
    const build = () => new durability.EventsDurability()
    expect(build).toThrow()
  })

  it('package.json exposes ./durability next to the main entry', () => {
    const pj = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, unknown> }
    expect(Object.keys(pj.exports).sort()).toEqual(['.', './durability'])
  })
})
