/**
 * Entry layout of `create-botmesh`: the main entry is the programmatic scaffolder
 * (`scaffold`, `sanitizeName`, `getTemplate`, `TEMPLATE_NAMES`); the template table,
 * the AGENTS.md renderer and the monorepo probe live in `create-botmesh/internal`
 * (no semver), as `@botmesh/core/internal` does for the engine. The main entry keeps
 * them as `@deprecated` re-exports until stable. Runtime names are pinned so growing
 * an entry is a deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = ['TEMPLATE_NAMES', 'getTemplate', 'sanitizeName', 'scaffold']
const MAIN_DEPRECATED_VALUES = ['TEMPLATES', 'agentsMd', 'findBotMeshMonorepo']
const INTERNAL_VALUES = ['TEMPLATES', 'agentsMd', 'findBotMeshMonorepo']

describe('create-botmesh entries', () => {
  it('main exports exactly these runtime names', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('/internal exports the template table, the AGENTS.md renderer and the monorepo probe', () => {
    expect(Object.keys(internal).sort()).toEqual(INTERNAL_VALUES)
  })

  it('the deprecated main re-exports are the /internal values', () => {
    for (const name of MAIN_DEPRECATED_VALUES) {
      expect(main[name as keyof typeof main]).toBe(internal[name as keyof typeof internal])
    }
  })

  it('marks every main re-export of an internal @deprecated', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    for (const name of MAIN_DEPRECATED_VALUES) {
      expect(source, name).toMatch(new RegExp(`/\\*\\* @deprecated[^*]*\\*/\\s*${name}\\b`))
    }
  })

  it('publishes ./internal in package.json exports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, { types: string, default: string }>
    }
    expect(pkg.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
  })
})
