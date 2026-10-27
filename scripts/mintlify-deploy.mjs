#!/usr/bin/env node
// Publishes the Mintlify site by hand (no GitHub Actions). Mintlify's GitHub App
// watches the `mintlify` branch of origin and redeploys on every push to it.
//   pnpm docs:mintlify              generate, check and force-push the site to origin's mintlify branch
//   pnpm docs:mintlify --dry-run    everything except the push; keeps the temp repo for inspection
//   --force-branch                  allow deploying from a branch other than main
//
// Steps: refuse a dirty working tree (or a branch other than main), install the
// mintlify/ tooling if missing (its own pnpm root, never the monorepo's), run
// mintlify/scripts/convert.mjs (docs/ + TypeDoc -> mintlify/site/, with the curated
// llms.txt pointing at MINTLIFY_SITE_URL), run `mint validate` and
// `mint broken-links --check-anchors --check-redirects` (in Docker on Windows,
// where mint 4.2 misreports nested links), then copy mintlify/site into a fresh
// git repo in the OS temp dir (docs.json at its root) with a single commit and
// `git push --force origin HEAD:mintlify`.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BRANCH = 'mintlify'
export const DEFAULT_SITE_URL = 'https://botmesh.mintlify.app/'
/** Files the generated site must contain before it is published. */
export const REQUIRED_FILES = ['docs.json', 'index.mdx', 'es/index.mdx', 'llms.txt', 'api/core/index.mdx']

/** Parses the command line; throws on an unknown option. */
export function parseArgs(argv) {
  const known = ['--dry-run', '--force-branch']
  for (const arg of argv) {
    if (!known.includes(arg)) throw new Error(`unknown option ${arg} (use ${known.join(', ')})`)
  }
  return { dryRun: argv.includes('--dry-run'), forceBranch: argv.includes('--force-branch') }
}

/** Validates MINTLIFY_SITE_URL: an absolute https URL, returned with a trailing slash. */
export function normalizeSiteUrl(value) {
  const raw = value === undefined || value === '' ? DEFAULT_SITE_URL : value
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`MINTLIFY_SITE_URL must be an absolute URL, got ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'https:') throw new Error(`MINTLIFY_SITE_URL must use https, got ${JSON.stringify(raw)}`)
  if (url.search || url.hash) throw new Error(`MINTLIFY_SITE_URL must not carry a query or fragment, got ${JSON.stringify(raw)}`)
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

/** Required files missing from a generated site directory. */
export function missingSiteFiles(siteDir, exists = existsSync) {
  return REQUIRED_FILES.filter((file) => !exists(join(siteDir, file)))
}

/**
 * How to run `mint broken-links`: the local CLI, or (Windows) the same mint
 * version in a Linux container, because mint 4.2 on Windows reports every link
 * with more than one path segment as broken.
 */
export function brokenLinksCommand({ platform, siteDir, mintBin, mintVersion, node = process.execPath }) {
  const checks = ['broken-links', '--check-anchors', '--check-redirects']
  if (platform !== 'win32') return { cmd: node, args: [mintBin, ...checks], cwd: siteDir }
  if (!/^[\w.-]+$/.test(mintVersion)) throw new Error(`unexpected mint version ${JSON.stringify(mintVersion)}`)
  return {
    cmd: 'docker',
    args: [
      'run', '--rm', '-v', `${siteDir}:/site`, '-w', '/site', 'node:22-bookworm-slim',
      'sh', '-c', `npm i -g mint@${mintVersion} >/dev/null 2>&1 && mint ${checks.join(' ')}`,
    ],
    cwd: siteDir,
  }
}

/** Counts the files and bytes of a directory, skipping its .git folder. */
export function sizeOf(dir) {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath ?? entry.path, entry.name)
    if (full.includes(join(dir, '.git'))) continue
    files++
    bytes += statSync(full).size
  }
  return { files, bytes }
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const tooling = join(root, 'mintlify')
  const siteDir = join(tooling, 'site')

  const fail = (message) => {
    console.error(`\n[mintlify-deploy] ${message}`)
    process.exit(1)
  }
  const step = (message) => console.log(`\n[mintlify-deploy] ${message}`)

  /** Runs a command, streaming its output; exits on failure. */
  const run = (cmd, cmdArgs, options = {}) => {
    // pnpm is a .cmd shim on Windows, which needs a shell. Node 24 deprecates passing an
    // args array together with `shell` (DEP0190), so the shell gets one command line; the
    // arguments are fixed literals here, nothing user-supplied.
    const viaShell = process.platform === 'win32' && cmd === 'pnpm'
    const result = viaShell
      ? spawnSync([cmd, ...cmdArgs].join(' '), { stdio: 'inherit', cwd: root, shell: true, ...options })
      : spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, ...options })
    if (result.error) fail(`${cmd} could not start: ${result.error.message}`)
    if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${result.status ?? result.signal})`)
  }

  /** Runs git and returns its trimmed stdout. */
  const git = (gitArgs, cwd = root, { allowFail = false } = {}) => {
    const result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' })
    if (result.status !== 0 && !allowFail) fail(`git ${gitArgs.join(' ')} failed:\n${result.stderr}`)
    return result.status === 0 ? result.stdout.trim() : ''
  }

  let options
  let siteUrl
  try {
    options = parseArgs(process.argv.slice(2))
    siteUrl = normalizeSiteUrl(process.env.MINTLIFY_SITE_URL)
  } catch (err) {
    fail(err.message)
  }
  const { dryRun, forceBranch } = options

  // 1. Preconditions: clean tree, main branch, an origin remote.
  step(dryRun ? 'dry run: nothing will be pushed' : `deploying to ${BRANCH} of origin`)
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current !== 'main' && !forceBranch) fail(`on branch "${current}": deploy from main, or pass --force-branch`)
  const dirty = git(['status', '--porcelain'])
  if (dirty) fail(`the working tree is not clean; commit or stash first:\n${dirty}`)
  const origin = git(['remote', 'get-url', 'origin'], root, { allowFail: true })
  if (!origin) fail('no "origin" remote configured')
  const sha = git(['rev-parse', '--short', 'HEAD'])
  console.log(`  branch ${current} @ ${sha}, origin ${origin}, site ${siteUrl}`)

  // 2. The tooling is its own pnpm root (mintlify/pnpm-workspace.yaml): installing from
  // that folder never touches the monorepo, and its allowBuilds list applies.
  if (!existsSync(join(tooling, 'node_modules', 'mint', 'package.json'))) {
    step('installing the Mintlify tooling (pnpm install in mintlify/)')
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: tooling })
  }
  const mintPkg = JSON.parse(readFileSync(join(tooling, 'node_modules', 'mint', 'package.json'), 'utf8'))
  const mintBin = resolve(tooling, 'node_modules', 'mint', typeof mintPkg.bin === 'string' ? mintPkg.bin : mintPkg.bin.mint)

  // 3. Generate the site.
  step(`generating mintlify/site (llms.txt links -> ${siteUrl})`)
  run(process.execPath, [join(tooling, 'scripts', 'convert.mjs'), '--llms-base', siteUrl])
  const missing = missingSiteFiles(siteDir)
  if (missing.length) fail(`mintlify/site is missing ${missing.join(', ')}`)

  // 4. Check it.
  step('mint validate')
  run(process.execPath, [mintBin, 'validate'], { cwd: siteDir })
  step(process.platform === 'win32' ? 'mint broken-links (in Docker: mint misreports nested links on Windows)' : 'mint broken-links')
  const links = brokenLinksCommand({ platform: process.platform, siteDir, mintBin, mintVersion: mintPkg.version })
  run(links.cmd, links.args, { cwd: links.cwd })

  // 5. A fresh repo with one commit holding the site, docs.json at its root.
  const tmp = mkdtempSync(join(tmpdir(), 'botmesh-mintlify-'))
  step(`preparing the ${BRANCH} commit in ${tmp}`)
  cpSync(siteDir, tmp, { recursive: true })
  git(['init', '--quiet', '--initial-branch', BRANCH], tmp)
  git(['config', 'core.autocrlf', 'false'], tmp)
  for (const key of ['user.name', 'user.email']) {
    const value = git(['config', key], root, { allowFail: true })
    if (value) git(['config', key, value], tmp)
  }
  git(['remote', 'add', 'origin', origin], tmp)
  git(['add', '--all'], tmp)
  git(['commit', '--quiet', '-m', `docs: deploy ${sha} to Mintlify`], tmp)
  const commit = git(['log', '--oneline', '-1'], tmp)
  const { files, bytes } = sizeOf(tmp)
  const top = readdirSync(tmp).filter((name) => name !== '.git').sort()
  console.log(`  commit  ${commit}`)
  console.log(`  content ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
  console.log(`  top     ${top.join(' ')}`)

  // 6. Push (or stop here).
  if (dryRun) {
    step('dry run done. Would run:')
    console.log(`  git -C ${tmp} push --force origin HEAD:${BRANCH}`)
    console.log(`  (origin = ${origin})`)
    console.log('  The temp repo is kept for inspection; delete it when done.')
    process.exit(0)
  }
  step(`pushing to ${origin} ${BRANCH} (force)`)
  run('git', ['push', '--force', 'origin', `HEAD:${BRANCH}`], { cwd: tmp })
  rmSync(tmp, { recursive: true, force: true })
  step(`done. Mintlify redeploys from the ${BRANCH} branch in a minute or two: ${siteUrl}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
