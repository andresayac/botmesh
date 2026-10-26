/**
 * Entry layout of `@botmesh/dialogflow` (API freeze before its first public release, see
 * docs/release-readiness.md): the main entry holds what an application needs and is covered
 * by semver; the building blocks live in `/internal` (no semver). The runtime
 * names of each entry are pinned here so that growing one is a deliberate change. Types are
 * checked by `pnpm api-check`.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

/** Every runtime (value) export of the main entry. */
const MAIN_VALUES = ['DialogflowClient', 'DialogflowContext', 'DialogflowError', 'ServiceAccountTokenSource', 'dialogflowPlugin', 'whenDialogflowIntent', 'withDialogflowState'] as const

/** `@deprecated` aliases kept on the main entry (one canonical name per concept). */
const MAIN_DEPRECATED_VALUES = ['dialogflowContext'] as const

/** Runtime exports of `/internal` (helpers that are not part of the semver surface). */
const INTERNAL_VALUES = ['DEFAULT_TOKEN_URI', 'DIALOGFLOW_SCOPE', 'createServiceAccountJwt', 'normalizeCxResult', 'normalizeEsResult', 'parseCredentials', 'toSessionId'] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/dialogflow entry layout', () => {
  it('the main entry exports exactly the application values', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('/internal exports exactly the building blocks, none of them on the main entry', () => {
    expect(keysOf(internal)).toEqual([...INTERNAL_VALUES].sort())
    for (const name of INTERNAL_VALUES) expect((main as Record<string, unknown>)[name], name).toBeUndefined()
  })

  it('the deprecated dialogflowContext is the same function as dialogflowPlugin', () => {
    expect(main.dialogflowContext).toBe(main.dialogflowPlugin)
  })
})
