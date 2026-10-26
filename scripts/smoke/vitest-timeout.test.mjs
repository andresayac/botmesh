// Run with: pnpm test:scripts
// AGENTS.md promises a 10 s default test timeout. Without a vitest.config.* setting it, Vitest
// uses 5 s, and file-heavy tests (journals, SQLite, conformance loops) time out on a loaded CI
// runner. Every workspace package with tests must set testTimeout >= 10 s in its config.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

function packagesWithTests() {
  const dirs = []
  for (const group of ['packages', 'examples']) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      const dir = join(root, group, entry.name)
      if (entry.isDirectory() && existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'tests'))) dirs.push(dir)
    }
  }
  return dirs
}

/** The testTimeout a vitest config sets, in ms, or undefined. */
export function configuredTimeout(source) {
  const m = /testTimeout:\s*([\d_]+)/.exec(source)
  return m ? Number(m[1].replaceAll('_', '')) : undefined
}

test('configuredTimeout reads numeric separators', () => {
  assert.equal(configuredTimeout('test: { testTimeout: 10_000 }'), 10000)
  assert.equal(configuredTimeout('test: {}'), undefined)
})

test('every package with tests sets testTimeout >= 10 s', () => {
  const offenders = []
  for (const dir of packagesWithTests()) {
    const config = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs'].map((f) => join(dir, f)).find(existsSync)
    const timeout = config ? configuredTimeout(readFileSync(config, 'utf8')) : undefined
    if (!(timeout >= 10_000)) offenders.push(`${dir.slice(root.length + 1)} (${config ? `testTimeout ${timeout ?? 'unset'}` : 'no vitest.config'})`)
  }
  assert.deepEqual(offenders, [])
})
