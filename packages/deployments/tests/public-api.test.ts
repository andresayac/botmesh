import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as api from '../src/index.js'

/**
 * `stripInternal` removes `@internal` declarations from the published `.d.ts`. Re-exporting
 * one from the entry point leaves `export { name } from './x.js'` pointing at nothing, which
 * breaks every consumer that type-checks its dependencies (`skipLibCheck: false`).
 */
describe('public API', () => {
  it('does not re-export @internal declarations', () => {
    const src = join(import.meta.dirname, '..', 'src')
    const internal = new Set<string>()
    for (const file of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(src, file), 'utf8')
      for (const m of text.matchAll(/@internal[^\n]*\s*\*\/\s*export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) internal.add(m[1]!)
    }
    expect(internal.size).toBeGreaterThan(0)
    for (const name of internal) expect(Object.keys(api), name).not.toContain(name)
  })
})
