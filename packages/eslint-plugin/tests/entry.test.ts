/**
 * Entry layout of `eslint-plugin-botmesh` (public, semver): the default export is the plugin
 * (`meta`, `rules`, `configs`), plus the named `rules`, `configs` and `PLUGIN_NAMESPACE`. The rule
 * modules are reached through `rules['<name>']`, never as named exports. Runtime names are pinned
 * so growing the entry is a deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  private?: boolean
  exports: Record<string, unknown>
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
}

describe('eslint-plugin-botmesh entry', () => {
  it('exports exactly the plugin, its rules, its configs and the namespace', () => {
    expect(Object.keys(main).sort()).toEqual(['PLUGIN_NAMESPACE', 'configs', 'default', 'rules'])
  })

  it('reports the package version in meta (read from package.json, never hard-coded)', () => {
    expect(main.default.meta).toEqual({ name: pkg.name, version: pkg.version, namespace: 'botmesh' })
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/version:\s*'\d+\.\d+\.\d+/)
  })

  it('is publishable: not private, only the main entry, eslint as its only peer and no runtime dependencies', () => {
    expect(pkg.private).toBeUndefined()
    expect(Object.keys(pkg.exports)).toEqual(['.'])
    expect(pkg.peerDependencies).toEqual({ eslint: '>=9.0.0' })
    expect(pkg.dependencies ?? {}).toEqual({})
  })
})

describe('rule docs links', () => {
  it('every rule links to its section of the live guide', () => {
    for (const [name, rule] of Object.entries(main.rules)) {
      expect(rule.meta?.docs?.url, name).toBe(`https://botmesh.afaya.com.co/guide/eslint#botmesh/${name}`)
    }
  })
})
