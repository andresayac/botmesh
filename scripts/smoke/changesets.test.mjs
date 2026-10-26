// Run with: pnpm test:scripts
// Every changeset (pending in .changeset/ or archived by pre mode in .changeset/pre/) must name
// packages of this workspace: `changeset status`/`version` stop at the first unknown name, and
// `changeset pre exit` moves the archived ones back for the stable release.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

function workspaceNames() {
  const names = new Set()
  for (const dir of ['packages', 'examples']) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        names.add(JSON.parse(readFileSync(join(root, dir, entry.name, 'package.json'), 'utf8')).name)
      } catch {
        // not a package
      }
    }
  }
  return names
}

/** Package names in a changeset's front matter. */
export function changesetPackages(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return []
  return m[1].split(/\r?\n/).map((l) => /^\s*["']?([^"':]+)["']?\s*:/.exec(l)?.[1]).filter(Boolean)
}

test('parses package names from front matter', () => {
  assert.deepEqual(changesetPackages('---\n"@botmesh/core": patch\ncreate-botmesh: minor\n---\n\nnote "x": y'), ['@botmesh/core', 'create-botmesh'])
})

test('every changeset names a package of the workspace', () => {
  const known = workspaceNames()
  const unknown = []
  for (const dir of ['.changeset', join('.changeset', 'pre')]) {
    let files = []
    try {
      files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.md') && f !== 'README.md')
    } catch {
      continue
    }
    for (const f of files) {
      for (const name of changesetPackages(readFileSync(join(root, dir, f), 'utf8'))) {
        if (!known.has(name)) unknown.push(`${dir}/${f}: ${name}`)
      }
    }
  }
  assert.deepEqual(unknown, [])
})
