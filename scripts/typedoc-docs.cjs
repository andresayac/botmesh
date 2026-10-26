#!/usr/bin/env node
/**
 * typedoc-docs.cjs — run TypeDoc from the monorepo root.
 *
 * `.cjs` because the workspace root is `"type": "module"`; this script uses
 * CommonJS (`require`) intentionally.
 *
 * TypeDoc 0.28 does not support TypeScript 7 (the version used for the build),
 * so the `typescript-5` alias (typescript@5.9.3) is installed at the root and
 * TypeDoc is resolved against it. We locate TypeDoc's bin via `require.resolve`
 * rather than hardcoding a pnpm store path (which changes across installs).
 */
'use strict'

const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

let typedocBin
try {
  // typedoc exposes its bin path in package.json "bin"
  const pkg = require('typedoc/package.json')
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.typedoc
  typedocBin = resolve(dirname(require.resolve('typedoc/package.json')), rel)
} catch (err) {
  console.error('[typedoc-docs] Could not resolve the "typedoc" package. Is it installed at the root?')
  console.error(err && err.message)
  process.exit(1)
}

// Header link from the API reference back to the guide. An absolute path, so it
// works from every page depth; DOCS_BASE is the site base (`/botmesh/` on GitHub
// Pages, see docs/.vitepress/config.ts).
const base = process.env.DOCS_BASE || '/'
if (!/^\/(?:[^/\s]+\/)*$/.test(base)) {
  console.error(`[typedoc-docs] DOCS_BASE must start and end with "/", got ${JSON.stringify(base)}`)
  process.exit(1)
}
// TypeDoc only reads `navigationLinks` from an options file, so the --options
// file is wrapped in a temporary one that extends it (relative paths in the
// extended file still resolve against its own directory).
const args = process.argv.slice(2)
const at = args.indexOf('--options')
let tmp
if (at >= 0 && args[at + 1]) {
  tmp = mkdtempSync(join(tmpdir(), 'botmesh-typedoc-'))
  const wrapper = join(tmp, 'typedoc.json')
  const options = {
    extends: [resolve(__dirname, '..', args[at + 1])],
    navigationLinks: { Guide: `${base}guide/getting-started` },
  }
  writeFileSync(wrapper, JSON.stringify(options, null, 2))
  args[at + 1] = wrapper
}

const result = spawnSync(process.execPath, [typedocBin, ...args], {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..'),
})
if (tmp) rmSync(tmp, { recursive: true, force: true })
process.exit(result.status ?? 1)
