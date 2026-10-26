/**
 * Entry layout of `@botmesh/wppconnect` (public since the 1.0 beta): the main entry holds what an
 * application needs (the provider, its config, the error mapper and the loosely typed WA-JS
 * shapes, `@experimental`); the webhook parser and the outbound mapper live in `/internal`
 * (no semver). The runtime names of each entry are pinned so that growing the main entry is a
 * deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = ['WPPConnectProvider', 'toWppError'] as const

const INTERNAL_VALUES = [
  'parseWebhook', 'parseMessage', 'serializedId', 'jidOf', 'remoteOfMessageId', 'lidsIn',
  'toOutbound', 'target', 'numberedMenu',
] as const

describe('@botmesh/wppconnect entries', () => {
  it('pins the runtime names of the main entry', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES].sort())
  })

  it('pins the runtime names of /internal', () => {
    expect(Object.keys(internal).sort()).toEqual([...INTERNAL_VALUES].sort())
  })

  it('publishes both entries and depends on public packages only', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(pkg.private).toBeUndefined()
    expect(Object.keys(pkg.exports as object)).toEqual(['.', './internal'])
    expect(pkg.publishConfig).toEqual({ access: 'public' })
    const deps = pkg.dependencies as Record<string, string>
    expect(Object.keys(deps).filter((d) => d.startsWith('@botmesh/')).sort()).toEqual(['@botmesh/core', '@botmesh/http', '@botmesh/wa-gateway-kit'])
    for (const range of Object.values(deps)) if (range.startsWith('workspace:')) expect(range).toBe('workspace:^')
  })
})
