/**
 * The published declarations must not need `@types/better-sqlite3`: consumers
 * compile with `skipLibCheck: false` and better-sqlite3 ships no types of its own.
 * Walks every `.d.ts` reachable from `lib/index.d.ts` (run after `pnpm build`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const lib = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

function reachable(entry: string): string[] {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/from\s+'(\.[^']+)\.js'/g)) stack.push(join(dirname(file), `${m[1]}.d.ts`))
  }
  return [...seen]
}

describe.skipIf(!existsSync(join(lib, 'index.d.ts')))('published declarations', () => {
  it('never import better-sqlite3 types from a file reachable from the entry point', () => {
    const offenders = reachable(join(lib, 'index.d.ts')).filter((f) => /from\s+'better-sqlite3'/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => f.slice(lib.length + 1))).toEqual([])
  })
})
