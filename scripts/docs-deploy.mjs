#!/usr/bin/env node
// Publishes the GitHub Pages site by hand (no GitHub Actions). The docs live on
// Mintlify (https://botmesh.afaya.com.co/, `pnpm docs:mintlify`); GitHub Pages
// (https://andresayac.github.io/botmesh/) only redirects there:
//   pnpm docs:deploy --redirects              build the redirect stubs and force-push them to origin's gh-pages
//   pnpm docs:deploy --redirects --dry-run    everything except the push; keeps the temp repo for inspection
//   pnpm docs:deploy                          (legacy) publish the full VitePress site instead
//   --force-branch                            allow deploying from a branch other than main
//
// Both modes refuse a dirty working tree (or a branch other than main) and build
// the VitePress site with DOCS_BASE=/botmesh/ (`pnpm run docs`: TypeDoc +
// VitePress + API copy).
// --redirects: generates the Mintlify site (mintlify/scripts/convert.mjs, with
// --llms-base $MINTLIFY_SITE_URL), then writes one stub per HTML page of that
// build at the same path (scripts/docs-redirects.mjs: JS location.replace that
// keeps and translates the hash, meta refresh, rel=canonical, a visible link),
// plus the Mintlify llms.txt and .nojekyll; every target must exist in mintlify/site.
// Legacy mode: runs docs-check on docs/dist and publishes it with .nojekyll
// (TypeDoc emits `_`-prefixed files that Jekyll would drop).
// Then the tree goes into a fresh git repo in the OS temp dir with a single
// commit and `git push --force origin HEAD:gh-pages`.
// GitHub must be set to Settings -> Pages -> Deploy from a branch -> gh-pages / (root).
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadSiteMap } from '../mintlify/scripts/site-map.mjs'
import { listHtml, planRedirects, redirectStub } from './docs-redirects.mjs'
import { normalizeSiteUrl } from './mintlify-deploy.mjs'
import { detectBase } from './smoke/docs-check.mjs'

/** Parses the command line; throws on an unknown option. */
export function parseArgs(argv) {
  const known = ['--dry-run', '--force-branch', '--redirects']
  for (const arg of argv) {
    if (!known.includes(arg)) throw new Error(`unknown option ${arg} (use ${known.join(', ')})`)
  }
  return { dryRun: argv.includes('--dry-run'), forceBranch: argv.includes('--force-branch'), redirects: argv.includes('--redirects') }
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const distDir = join(root, 'docs', 'dist')
  const tooling = join(root, 'mintlify')
  const siteDir = join(tooling, 'site')
  const base = process.env.DOCS_BASE || '/botmesh/'
  const branch = 'gh-pages'

  const fail = (message) => {
    console.error(`\n[docs-deploy] ${message}`)
    process.exit(1)
  }
  const step = (message) => console.log(`\n[docs-deploy] ${message}`)

  let options
  let mintlifyUrl
  try {
    options = parseArgs(process.argv.slice(2))
    mintlifyUrl = normalizeSiteUrl(process.env.MINTLIFY_SITE_URL)
  } catch (err) {
    fail(err.message)
  }
  const { dryRun, forceBranch, redirects } = options
  if (!/^\/(?:[^/\s]+\/)*$/.test(base)) fail(`DOCS_BASE must start and end with "/", got ${JSON.stringify(base)}`)

  /** Runs a command, streaming its output; exits on failure. */
  const run = (cmd, cmdArgs, runOptions = {}) => {
    // pnpm is a .cmd shim on Windows, which needs a shell. Node 24 deprecates passing an
    // args array together with `shell` (DEP0190), so the shell gets one command line; the
    // arguments are fixed literals here, nothing user-supplied.
    const viaShell = process.platform === 'win32' && cmd === 'pnpm'
    const result = viaShell
      ? spawnSync([cmd, ...cmdArgs].join(' '), { stdio: 'inherit', cwd: root, shell: true, ...runOptions })
      : spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, ...runOptions })
    if (result.error) fail(`${cmd} could not start: ${result.error.message}`)
    if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${result.status ?? result.signal})`)
  }

  /** Runs git and returns its trimmed stdout. */
  const git = (gitArgs, cwd = root, { allowFail = false } = {}) => {
    const result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' })
    if (result.status !== 0 && !allowFail) fail(`git ${gitArgs.join(' ')} failed:\n${result.stderr}`)
    return result.status === 0 ? result.stdout.trim() : ''
  }

  const sizeOf = (dir) => {
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
  step(`${dryRun ? 'dry run: nothing will be pushed' : `deploying to ${branch} of origin`} (${redirects ? `redirects to ${mintlifyUrl}` : 'full VitePress site'})`)
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current !== 'main' && !forceBranch) fail(`on branch "${current}": deploy from main, or pass --force-branch`)
  const dirty = git(['status', '--porcelain'])
  if (dirty) fail(`the working tree is not clean; commit or stash first:\n${dirty}`)
  const origin = git(['remote', 'get-url', 'origin'], root, { allowFail: true })
  if (!origin) fail('no "origin" remote configured')
  const sha = git(['rev-parse', '--short', 'HEAD'])
  console.log(`  branch ${current} @ ${sha}, origin ${origin}, base ${base}`)

  // 2. Build the VitePress site under the Pages sub-path (in redirect mode, it lists the pages to redirect).
  step(`building the docs with DOCS_BASE=${base} (pnpm run docs)`)
  run('pnpm', ['run', 'docs'], { env: { ...process.env, DOCS_BASE: base, MSYS_NO_PATHCONV: '1' } })
  const built = detectBase(readFileSync(join(distDir, 'index.html'), 'utf8'))
  if (built !== base) fail(`docs/dist was built for base ${built}, expected ${base}`)
  for (const required of ['index.html', '404.html', 'api/index.html', 'es/index.html']) {
    if (!existsSync(join(distDir, required))) fail(`docs/dist/${required} is missing`)
  }

  const tmp = mkdtempSync(join(tmpdir(), 'botmesh-gh-pages-'))
  if (redirects) {
    // 3. Generate the Mintlify site: the targets must exist, and the converter
    // writes the anchor table (mintlify/.cache/anchors.json) and llms.txt.
    if (!existsSync(join(tooling, 'node_modules', 'mint', 'package.json'))) {
      step('installing the Mintlify tooling (pnpm install in mintlify/)')
      run('pnpm', ['install', '--frozen-lockfile'], { cwd: tooling })
    }
    step(`generating mintlify/site (links -> ${mintlifyUrl})`)
    run(process.execPath, [join(tooling, 'scripts', 'convert.mjs'), '--llms-base', mintlifyUrl])
    const anchorTable = JSON.parse(readFileSync(join(tooling, '.cache', 'anchors.json'), 'utf8'))
    const sitePage = (path) => {
      const rel = path.replace(/^\/+/, '')
      if (rel === '') return existsSync(join(siteDir, 'index.mdx'))
      return existsSync(join(siteDir, `${rel}.mdx`)) || existsSync(join(siteDir, rel, 'index.mdx'))
    }

    // 4. One stub per HTML page of the old site.
    step(`writing the redirect stubs in ${tmp}`)
    const map = loadSiteMap(join(root, 'docs'))
    const plan = planRedirects({ files: listHtml(distDir), map, siteUrl: mintlifyUrl, anchorTable, hasPage: (page) => sitePage(`/${page}`) })
    const missing = plan.filter((r) => r.kind !== 'github' && !sitePage(r.path))
    if (missing.length) fail(`redirect targets missing from mintlify/site:\n${missing.map((r) => `  ${r.file} -> ${r.path}`).join('\n')}`)
    for (const r of plan) {
      const target = join(tmp, r.file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, redirectStub(r))
    }
    // The old llms.txt URL keeps answering, with the Mintlify links.
    cpSync(join(siteDir, 'llms.txt'), join(tmp, 'llms.txt'))
    const kinds = {}
    for (const r of plan) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1
    console.log(`  ${plan.length} stubs: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`)
    for (const r of plan.filter((p) => p.kind === 'home' || p.kind === 'github')) console.log(`  ${r.file} -> ${r.url}`)
  } else {
    // 3. Check the build.
    step('checking links, anchors and the base path (docs-check)')
    run(process.execPath, [join(root, 'scripts', 'smoke', 'docs-check.mjs'), `--base=${base}`])
    if (!existsSync(join(distDir, 'sitemap.xml'))) fail('docs/dist/sitemap.xml is missing')
    step(`preparing the ${branch} commit in ${tmp}`)
    cpSync(distDir, tmp, { recursive: true })
  }
  // Without it, GitHub Pages runs Jekyll, which drops `_`-prefixed files.
  writeFileSync(join(tmp, '.nojekyll'), '')

  // 5. A fresh repo with one commit.
  git(['init', '--quiet', '--initial-branch', branch], tmp)
  git(['config', 'core.autocrlf', 'false'], tmp)
  for (const key of ['user.name', 'user.email']) {
    const value = git(['config', key], root, { allowFail: true })
    if (value) git(['config', key, value], tmp)
  }
  git(['remote', 'add', 'origin', origin], tmp)
  git(['add', '--all'], tmp)
  git(['commit', '--quiet', '-m', redirects ? `docs: redirect to ${mintlifyUrl} (${sha})` : `docs: deploy ${sha}`], tmp)
  const commit = git(['log', '--oneline', '-1'], tmp)
  const { files, bytes } = sizeOf(tmp)
  const top = readdirSync(tmp).filter((name) => name !== '.git').sort()
  console.log(`  commit  ${commit}`)
  console.log(`  content ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
  console.log(`  top     ${top.join(' ')}`)

  // 6. Push (or stop here).
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
  step(`done. GitHub Pages republishes in a minute or two: ${site}${redirects ? ` (redirects to ${mintlifyUrl})` : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
