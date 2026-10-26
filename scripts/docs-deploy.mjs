#!/usr/bin/env node
// Publishes the docs site to GitHub Pages by hand (no GitHub Actions):
//   pnpm docs:deploy              build, check and force-push docs/dist to origin's gh-pages
//   pnpm docs:deploy --dry-run    everything except the push; keeps the temp repo for inspection
//   --force-branch                allow deploying from a branch other than main
//
// Steps: refuse a dirty working tree (or a branch other than main), build with
// DOCS_BASE=/botmesh/ (`pnpm run docs`: TypeDoc + VitePress + API copy), run
// docs-check against that build, add .nojekyll (TypeDoc emits `_`-prefixed
// files that Jekyll would drop), then copy docs/dist into a fresh git repo in
// the OS temp dir with a single commit and `git push --force origin HEAD:gh-pages`.
// GitHub must be set to Settings -> Pages -> Deploy from a branch -> gh-pages / (root).
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectBase } from './smoke/docs-check.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(root, 'docs', 'dist')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const forceBranch = args.has('--force-branch')
const base = process.env.DOCS_BASE || '/botmesh/'
const branch = 'gh-pages'

for (const arg of args) {
  if (!['--dry-run', '--force-branch'].includes(arg)) fail(`unknown option ${arg} (use --dry-run, --force-branch)`)
}
if (!/^\/(?:[^/\s]+\/)*$/.test(base)) fail(`DOCS_BASE must start and end with "/", got ${JSON.stringify(base)}`)

function fail(message) {
  console.error(`\n[docs-deploy] ${message}`)
  process.exit(1)
}

function step(message) {
  console.log(`\n[docs-deploy] ${message}`)
}

/** Runs a command, streaming its output; exits on failure. */
function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    cwd: root,
    // pnpm is a .cmd shim on Windows.
    shell: process.platform === 'win32' && cmd === 'pnpm',
    ...options,
  })
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${result.status ?? result.signal})`)
}

/** Runs git and returns its trimmed stdout. */
function git(gitArgs, cwd = root, { allowFail = false } = {}) {
  const result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' })
  if (result.status !== 0 && !allowFail) fail(`git ${gitArgs.join(' ')} failed:\n${result.stderr}`)
  return result.status === 0 ? result.stdout.trim() : ''
}

function sizeOf(dir) {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath ?? entry.path, entry.name)
    if (full.includes(`${join(dir, '.git')}`)) continue
    files++
    bytes += statSync(full).size
  }
  return { files, bytes }
}

// 1. Preconditions: clean tree, main branch, an origin remote.
step(dryRun ? 'dry run: nothing will be pushed' : `deploying to ${branch} of origin`)
const current = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (current !== 'main' && !forceBranch) fail(`on branch "${current}": deploy from main, or pass --force-branch`)
const dirty = git(['status', '--porcelain'])
if (dirty) fail(`the working tree is not clean; commit or stash first:\n${dirty}`)
const origin = git(['remote', 'get-url', 'origin'], root, { allowFail: true })
if (!origin) fail('no "origin" remote configured')
const sha = git(['rev-parse', '--short', 'HEAD'])
console.log(`  branch ${current} @ ${sha}, origin ${origin}, base ${base}`)

// 2. Build the site under the Pages sub-path.
step(`building the docs with DOCS_BASE=${base} (pnpm run docs)`)
run('pnpm', ['run', 'docs'], { env: { ...process.env, DOCS_BASE: base, MSYS_NO_PATHCONV: '1' } })

// 3. Check the build.
step('checking links, anchors and the base path (docs-check)')
run(process.execPath, [join(root, 'scripts', 'smoke', 'docs-check.mjs'), `--base=${base}`])
const built = detectBase(readFileSync(join(distDir, 'index.html'), 'utf8'))
if (built !== base) fail(`docs/dist was built for base ${built}, expected ${base}`)
for (const required of ['index.html', '404.html', 'api/index.html', 'es/index.html', 'sitemap.xml']) {
  if (!existsSync(join(distDir, required))) fail(`docs/dist/${required} is missing`)
}
// Without it, GitHub Pages runs Jekyll, which drops TypeDoc's `_`-prefixed files.
writeFileSync(join(distDir, '.nojekyll'), '')

// 4. A fresh repo with one commit holding docs/dist.
const tmp = mkdtempSync(join(tmpdir(), 'botmesh-gh-pages-'))
step(`preparing the ${branch} commit in ${tmp}`)
cpSync(distDir, tmp, { recursive: true })
git(['init', '--quiet', '--initial-branch', branch], tmp)
git(['config', 'core.autocrlf', 'false'], tmp)
for (const key of ['user.name', 'user.email']) {
  const value = git(['config', key], root, { allowFail: true })
  if (value) git(['config', key, value], tmp)
}
git(['remote', 'add', 'origin', origin], tmp)
git(['add', '--all'], tmp)
git(['commit', '--quiet', '-m', `docs: deploy ${sha}`], tmp)
const commit = git(['log', '--oneline', '-1'], tmp)
const { files, bytes } = sizeOf(tmp)
const top = readdirSync(tmp).filter((name) => name !== '.git').sort()
console.log(`  commit  ${commit}`)
console.log(`  content ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
console.log(`  top     ${top.join(' ')}`)

// 5. Push (or stop here).
if (dryRun) {
  step('dry run done. Would run:')
  console.log(`  git -C ${tmp} push --force origin HEAD:${branch}`)
  console.log(`  (origin = ${origin})`)
  console.log(`  The temp repo is kept for inspection; delete it when done.`)
  process.exit(0)
}
step(`pushing to ${origin} ${branch} (force)`)
run('git', ['push', '--force', 'origin', `HEAD:${branch}`], { cwd: tmp })
rmSync(tmp, { recursive: true, force: true })
const site = process.env.DOCS_SITE_URL || 'https://andresayac.github.io/botmesh/'
step(`done. GitHub Pages republishes in a minute or two: ${site}`)
