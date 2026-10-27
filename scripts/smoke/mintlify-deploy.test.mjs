// Run with: pnpm test:scripts
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DEFAULT_REPO,
  DEFAULT_SITE_URL,
  REQUIRED_FILES,
  brokenLinksCommand,
  missingSiteFiles,
  normalizeSiteUrl,
  parseArgs,
  resolveTarget,
  sizeOf,
} from '../mintlify-deploy.mjs'

test('parseArgs reads --dry-run and --force-branch and rejects anything else', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, forceBranch: false })
  assert.deepEqual(parseArgs(['--dry-run', '--force-branch']), { dryRun: true, forceBranch: true })
  assert.throws(() => parseArgs(['--push']), /unknown option --push/)
})

test('the default target is the main branch of the botmesh-docs repo and the Mintlify subdomain', () => {
  assert.equal(DEFAULT_REPO, 'https://github.com/andresayac/botmesh-docs.git')
  assert.equal(DEFAULT_SITE_URL, 'https://botmesh.mintlify.app/')
  assert.deepEqual(resolveTarget({}), { repo: DEFAULT_REPO, branch: 'main' })
})

test('resolveTarget reads MINTLIFY_REPO and MINTLIFY_BRANCH and refuses unsafe values', () => {
  assert.deepEqual(
    resolveTarget({ MINTLIFY_REPO: 'git@github.com:me/docs.git', MINTLIFY_BRANCH: 'mintlify' }),
    { repo: 'git@github.com:me/docs.git', branch: 'mintlify' },
  )
  assert.deepEqual(resolveTarget({ MINTLIFY_REPO: '', MINTLIFY_BRANCH: '' }), { repo: DEFAULT_REPO, branch: 'main' })
  assert.throws(() => resolveTarget({ MINTLIFY_REPO: 'http://github.com/me/docs.git' }), /MINTLIFY_REPO/)
  assert.throws(() => resolveTarget({ MINTLIFY_REPO: 'https://user:token@github.com/me/docs.git' }), /credentials/)
  assert.throws(() => resolveTarget({ MINTLIFY_REPO: '--upload-pack=x' }), /MINTLIFY_REPO/)
  assert.throws(() => resolveTarget({ MINTLIFY_BRANCH: '-x' }), /MINTLIFY_BRANCH/)
  assert.throws(() => resolveTarget({ MINTLIFY_BRANCH: 'a b' }), /MINTLIFY_BRANCH/)
})

test('normalizeSiteUrl defaults, adds the trailing slash and refuses unsafe values', () => {
  assert.equal(normalizeSiteUrl(undefined), DEFAULT_SITE_URL)
  assert.equal(normalizeSiteUrl(''), DEFAULT_SITE_URL)
  assert.equal(normalizeSiteUrl('https://docs.example.com'), 'https://docs.example.com/')
  assert.equal(normalizeSiteUrl('https://example.com/docs'), 'https://example.com/docs/')
  assert.throws(() => normalizeSiteUrl('http://docs.example.com/'), /https/)
  assert.throws(() => normalizeSiteUrl('docs.example.com'), /absolute URL/)
  assert.throws(() => normalizeSiteUrl('https://docs.example.com/?a=1'), /query or fragment/)
})

test('missingSiteFiles lists the required files that are absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mintlify-deploy-test-'))
  try {
    assert.deepEqual(missingSiteFiles(dir), REQUIRED_FILES)
    for (const file of REQUIRED_FILES) {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), 'x')
    }
    assert.deepEqual(missingSiteFiles(dir), [])
    assert.deepEqual(sizeOf(dir), { files: REQUIRED_FILES.length, bytes: REQUIRED_FILES.length })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sizeOf skips the .git folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mintlify-deploy-test-'))
  try {
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/mintlify\n')
    writeFileSync(join(dir, 'docs.json'), '{}')
    assert.deepEqual(sizeOf(dir), { files: 1, bytes: 2 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('brokenLinksCommand runs mint locally, or the same version in Docker on Windows', () => {
  const local = brokenLinksCommand({ platform: 'linux', siteDir: '/r/site', mintBin: '/r/mint/index.js', mintVersion: '4.2.1006', node: 'node' })
  assert.deepEqual(local, { cmd: 'node', args: ['/r/mint/index.js', 'broken-links', '--check-anchors', '--check-redirects'], cwd: '/r/site' })

  const win = brokenLinksCommand({ platform: 'win32', siteDir: 'C:\\r\\site', mintBin: 'x', mintVersion: '4.2.1006' })
  assert.equal(win.cmd, 'docker')
  assert.ok(win.args.includes('C:\\r\\site:/site'))
  assert.match(win.args.at(-1), /npm i -g mint@4\.2\.1006 .*&& mint broken-links --check-anchors --check-redirects$/)
  assert.throws(() => brokenLinksCommand({ platform: 'win32', siteDir: 'x', mintBin: 'x', mintVersion: '1; rm -rf /' }), /unexpected mint version/)
})
