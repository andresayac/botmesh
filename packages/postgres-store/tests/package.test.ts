/**
 * Packaging: what a consumer installs must typecheck. The public `.d.ts` files import
 * `pg` types (`NativePostgresPool` is pg's `Pool`), and `pg` ships no declarations, so
 * `@types/pg` has to come with the package: as a devDependency only, a consumer got
 * TS7016 ("Could not find a declaration file for module 'pg'") or, with skipLibCheck,
 * a `pool` option silently typed `any`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe('package.json', () => {
  it('ships @types/pg as a runtime dependency, because the public types reference pg', () => {
    const src = new URL('../src/', import.meta.url)
    const importsPg = readdirSync(src).some((f) => /from 'pg'/.test(readFileSync(new URL(f, src), 'utf8')))
    expect(importsPg).toBe(true)
    expect(pkg.dependencies?.['@types/pg']).toBeDefined()
    expect(pkg.devDependencies?.['@types/pg']).toBeUndefined()
  })
})
