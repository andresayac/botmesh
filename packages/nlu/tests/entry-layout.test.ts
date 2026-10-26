/**
 * Entry layout of `@botmesh/nlu` (API freeze before its first public release, see
 * docs/release-readiness.md): the main entry holds what an application needs and is covered
 * by semver; The runtime
 * names of each entry are pinned here so that growing one is a deliberate change. Types are
 * checked by `pnpm api-check`.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'

/** Every runtime (value) export of the main entry. */
const MAIN_VALUES = ['IntentEngine', 'nluPlugin', 'normalizeText', 'whenIntent'] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/nlu entry layout', () => {
  it('the main entry exports exactly the application values', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES].sort())
  })
})
