/**
 * Entry layout of `@botmesh/instagram` (frozen for the first public release): the main
 * entry is what an application needs (the provider, its config, the typed error mapper and
 * the webhook payload types); the Graph client and the wire helpers (`GraphClient`,
 * `parseInbound`, `toOutbound`) live in `@botmesh/instagram/internal` with no semver promise.
 * Runtime names are pinned so growing an entry is a deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = ['InstagramProvider', 'toInstagramError']
const INTERNAL_VALUES = ['GraphClient', 'parseInbound', 'toOutbound']

describe('@botmesh/instagram entries', () => {
  it('main exports exactly these runtime names', () => {
    expect(Object.keys(main).sort()).toEqual(MAIN_VALUES)
  })

  it('/internal exports the Graph client and the wire helpers', () => {
    expect(Object.keys(internal).sort()).toEqual(INTERNAL_VALUES)
  })

  it('publishes ./internal in package.json exports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, { types: string, default: string }>
      private?: boolean
    }
    expect(pkg.private).toBeUndefined()
    expect(pkg.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
  })
})
