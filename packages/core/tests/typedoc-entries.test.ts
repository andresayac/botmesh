/**
 * The TypeDoc reference documents the semver-covered entries — the main entry, `/spi` and
 * `/testing` — so a public type that lives on `/spi` is not a dangling reference (TypeDoc
 * warning). `/internal` (no semver) stays undocumented on purpose.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../typedoc.json', import.meta.url)), 'utf8')) as { entryPoints: string[] }

describe('TypeDoc entry points', () => {
  it('documents the main entry, /spi and /testing, never /internal', () => {
    expect(config.entryPoints).toEqual(['src/index.ts', 'src/spi.ts', 'src/testing/index.ts'])
    expect(config.entryPoints.some((e) => e.includes('internal'))).toBe(false)
  })

  it('each documented entry names its module after the import path', () => {
    for (const [file, name] of [['src/index.ts', '@botmesh/core'], ['src/spi.ts', '@botmesh/core/spi'], ['src/testing/index.ts', '@botmesh/core/testing']]) {
      const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
      expect(source).toContain(`@module ${name}\n`)
    }
  })
})
