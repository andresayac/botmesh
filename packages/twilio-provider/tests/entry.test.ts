/**
 * Entry layout of `@botmesh/twilio` (API freeze before its first npm release): the main entry holds
 * what an application needs and is covered by semver; the wire mappers and other building
 * blocks live in `@botmesh/twilio/internal` (no semver). The runtime names of each entry are pinned
 * here so that growing the main entry is a deliberate change.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

/** Runtime exports of the main entry covered by semver. */
const MAIN_VALUES = ['TwilioProvider', 'TWILIO_MAX_BODY', 'TwilioApiError', 'toTwilioError', 'computeTwilioSignature', 'verifyTwilioSignature'] as const

/** Deprecated aliases kept on the main entry until v3. */
const MAIN_DEPRECATED_VALUES = [] as const

/** Runtime exports of `/internal` (no semver). */
const INTERNAL_VALUES = ['parseFormParams', 'paramsFromObject', 'bodySha256', 'parseInbound', 'channelOf', 'toOutbound', 'mediaUrlOf'] as const

describe('@botmesh/twilio entries', () => {
  it('pins the runtime names of the main entry', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('pins the runtime names of /internal', () => {
    expect(Object.keys(internal).sort()).toEqual([...INTERNAL_VALUES].sort())
  })

  it('keeps the building blocks off the main entry', () => {
    for (const name of INTERNAL_VALUES) expect(main).not.toHaveProperty(name)
  })
})
