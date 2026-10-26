/**
 * Entry layout of `@botmesh/wa-gateway-kit` (public since the 1.0 beta). The kit is the SPI shared
 * by the WhatsApp REST gateway transports (`@botmesh/evolution`, `@botmesh/wppconnect`): its one
 * entry is covered by semver, because those packages depend on it with a caret range. The runtime
 * names are pinned here so that growing (or shrinking) the entry is a deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'

const MAIN_VALUES = [
  'restCall', 'resolveHttpPolicy', 'gatewayBaseUrl', 'parseRetryAfter', 'isRecord', 'describeErrorBody',
  'resolveMedia', 'guessMimetype', 'toDataUri',
  'WaIdentityStore', 'normalizeJid', 'isLidJid', 'isGroupJid',
] as const

describe('@botmesh/wa-gateway-kit entry', () => {
  it('pins the runtime names of the main entry', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES].sort())
  })

  it('is a public package with a single semver entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(pkg.private).toBeUndefined()
    expect(Object.keys(pkg.exports as object)).toEqual(['.'])
    expect(pkg.publishConfig).toEqual({ access: 'public' })
    for (const range of Object.values(pkg.dependencies as Record<string, string>)) {
      if (range.startsWith('workspace:')) expect(range).toBe('workspace:^')
    }
  })
})
