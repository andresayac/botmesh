/**
 * Group-admin contract stability (docs/release-readiness.md, `@botmesh/moderation`):
 * `GroupAdminApi` and `ModerationProvider.groups` describe a capability that no bundled
 * provider implements and that `@botmesh/core`'s `IProvider` does not define yet. When core
 * gains a groups namespace its shape may differ, so both are `@experimental` (outside semver)
 * while the rest of the moderation surface is frozen.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')

/** The TSDoc block right before `marker` in types.ts. */
function docBefore(marker: string): string {
  const at = source.indexOf(marker)
  expect(at, marker).toBeGreaterThan(0)
  const open = source.lastIndexOf('/**', at)
  const close = source.indexOf('*/', open)
  expect(close).toBeLessThan(at)
  expect(source.slice(close + 2, at).trim()).toBe('')
  return source.slice(open, close)
}

describe('group-admin contract is outside semver', () => {
  it.each(['export interface GroupAdminApi', '  groups?: GroupAdminApi'])('%s is marked @experimental', (marker) => {
    expect(docBefore(marker)).toMatch(/^\s*\*\s*@experimental\b/m)
  })

  it('the rest of ModerationProvider stays stable (not @experimental)', () => {
    expect(docBefore('export interface ModerationProvider')).not.toMatch(/@experimental/)
  })
})
