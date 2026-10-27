// Run with: pnpm test:scripts
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { legacyTarget, loadSiteMap } from '../../mintlify/scripts/site-map.mjs'
import { absoluteUrl, escapeHtml, listHtml, planRedirects, redirectStub, scriptJson } from '../docs-redirects.mjs'
import { parseArgs } from '../docs-deploy.mjs'

const SITE = 'https://botmesh.afaya.com.co/'
let root
let map

const CONFIG = `
import type { DefaultTheme } from 'vitepress'
const enSidebar = {
  '/guide/': [
    { text: 'Start', items: [{ text: 'Quick start', link: '/guide/getting-started' }, { text: 'Flows', link: '/guide/flows' }] },
  ],
  '/examples/': [{ text: 'Examples', items: [{ text: 'All', link: '/examples/index' }, { text: 'Menu', link: '/examples/menu-bot' }] }],
} satisfies DefaultTheme.SidebarMulti
const esSidebar = {
  '/es/guide/': [
    { text: 'Inicio', items: [{ text: 'Inicio rápido', link: '/es/guide/inicio' }, { text: 'Flujos', link: '/es/guide/flujos' }] },
  ],
  '/es/ejemplos/': [{ text: 'Ejemplos', items: [{ text: 'Todos', link: '/es/ejemplos/index' }, { text: 'Menú', link: '/es/ejemplos/bot-menu' }] }],
} satisfies DefaultTheme.SidebarMulti
`

before(() => {
  root = mkdtempSync(join(tmpdir(), 'docs-redirects-test-'))
  const docs = join(root, 'docs')
  for (const dir of ['.vitepress', 'guide', 'examples', 'es/guide', 'es/ejemplos']) mkdirSync(join(docs, dir), { recursive: true })
  writeFileSync(join(docs, '.vitepress', 'config.ts'), CONFIG)
  for (const page of ['index', 'es/index', 'guide/getting-started', 'guide/flows', 'examples/index', 'examples/menu-bot', 'es/guide/inicio', 'es/guide/flujos', 'es/ejemplos/index', 'es/ejemplos/bot-menu', 'MIGRATION-v1-to-v2']) {
    writeFileSync(join(docs, `${page}.md`), `# ${page}\n`)
  }
  map = loadSiteMap(docs)
})

after(() => rmSync(root, { recursive: true, force: true }))

test('guide and example pages keep their path; Spanish pages move to the English slug', () => {
  const to = (rel) => legacyTarget(rel, map)
  assert.deepEqual(to('index.html'), { kind: 'page', path: '/', page: 'index' })
  assert.deepEqual(to(''), { kind: 'page', path: '/', page: 'index' })
  assert.deepEqual(to('guide/flows.html'), { kind: 'page', path: '/guide/flows', page: 'guide/flows' })
  assert.deepEqual(to('guide/flows'), { kind: 'page', path: '/guide/flows', page: 'guide/flows' })
  assert.deepEqual(to('examples/index.html'), { kind: 'page', path: '/examples', page: 'examples/index' })
  assert.deepEqual(to('examples/'), { kind: 'page', path: '/examples', page: 'examples/index' })
  assert.deepEqual(to('es/index.html'), { kind: 'page', path: '/es', page: 'es/index' })
  assert.deepEqual(to('es/guide/flujos.html'), { kind: 'page', path: '/es/guide/flows', page: 'es/guide/flujos' })
  assert.deepEqual(to('es/guide/inicio'), { kind: 'page', path: '/es/guide/getting-started', page: 'es/guide/inicio' })
  assert.deepEqual(to('es/ejemplos/bot-menu.html'), { kind: 'page', path: '/es/examples/menu-bot', page: 'es/ejemplos/bot-menu' })
  assert.deepEqual(to('es/ejemplos/'), { kind: 'page', path: '/es/examples', page: 'es/ejemplos/index' })
})

test('unpublished repo files go to GitHub; unmapped pages and 404 go home', () => {
  const to = (rel) => legacyTarget(rel, map)
  assert.deepEqual(to('MIGRATION-v1-to-v2.html'), { kind: 'github', path: 'https://github.com/andresayac/botmesh/blob/main/docs/MIGRATION-v1-to-v2.md' })
  assert.deepEqual(to('404.html'), { kind: 'home', path: '/' })
  assert.deepEqual(to('guide/gone.html'), { kind: 'home', path: '/' })
  assert.deepEqual(to('es/guide/'), { kind: 'home', path: '/es' })
})

test('TypeDoc HTML pages map to the generated API pages, or their module when missing', () => {
  const generated = new Set(['api/core/classes/Bot', 'api/core/spi/interfaces/DurableKv', 'api/core/testing/functions/createTestBot'])
  const to = (rel) => legacyTarget(rel, map, { hasPage: (page) => generated.has(page) })
  assert.deepEqual(to('api/index.html'), { kind: 'api', path: '/api/core' })
  assert.deepEqual(to('api/classes/_botmesh_core.Bot.html'), { kind: 'api', path: '/api/core/classes/Bot' })
  assert.deepEqual(to('api/interfaces/_botmesh_core_spi.DurableKv.html'), { kind: 'api', path: '/api/core/spi/interfaces/DurableKv' })
  assert.deepEqual(to('api/functions/_botmesh_core_testing.createTestBot.html'), { kind: 'api', path: '/api/core/testing/functions/createTestBot' })
  assert.deepEqual(to('api/types/_botmesh_core.Missing.html'), { kind: 'api', path: '/api/core' })
  assert.deepEqual(to('api/modules/_botmesh_core_spi.html'), { kind: 'api', path: '/api/core/spi' })
  assert.deepEqual(to('api/hierarchy.html'), { kind: 'api', path: '/api/core' })
  assert.deepEqual(to('api/modules.html'), { kind: 'api', path: '/api/core' })
})

test('planRedirects builds absolute URLs, the anchor table of the page and the language', () => {
  const files = ['es/guide/flujos.html', 'api/classes/_botmesh_core.Bot.html', 'MIGRATION-v1-to-v2.html', '404.html']
  const plan = planRedirects({ files, map, siteUrl: SITE, anchorTable: { 'es/guide/flujos': { pasos: 'pasos-2', flujos: '' } }, hasPage: () => true })
  assert.deepEqual(plan, [
    { file: 'es/guide/flujos.html', kind: 'page', url: `${SITE}es/guide/flows`, path: '/es/guide/flows', anchors: { pasos: 'pasos-2', flujos: '' }, lowerAnchors: false, lang: 'es' },
    { file: 'api/classes/_botmesh_core.Bot.html', kind: 'api', url: `${SITE}api/core/classes/Bot`, path: '/api/core/classes/Bot', anchors: {}, lowerAnchors: true, lang: 'en' },
    { file: 'MIGRATION-v1-to-v2.html', kind: 'github', url: 'https://github.com/andresayac/botmesh/blob/main/docs/MIGRATION-v1-to-v2.md', path: 'https://github.com/andresayac/botmesh/blob/main/docs/MIGRATION-v1-to-v2.md', anchors: {}, lowerAnchors: false, lang: 'en' },
    { file: '404.html', kind: 'home', url: SITE, path: '/', anchors: {}, lowerAnchors: false, lang: 'en' },
  ])
  assert.equal(absoluteUrl(SITE, '/'), SITE)
})

test('the stub has a refresh, a canonical link, a hash-keeping location.replace and a visible link', () => {
  const html = redirectStub({ url: `${SITE}guide/flows`, anchors: { 'with-botmesh-ai': 'with-@botmesh/ai' } })
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<meta http-equiv="refresh" content="0; url=https:\/\/botmesh\.afaya\.com\.co\/guide\/flows">/)
  assert.match(html, /<link rel="canonical" href="https:\/\/botmesh\.afaya\.com\.co\/guide\/flows">/)
  assert.match(html, /<a href="https:\/\/botmesh\.afaya\.com\.co\/guide\/flows">/)
  assert.match(html, /location\.replace\(u\)/)
  assert.match(html, /<html lang="en">/)
  assert.match(redirectStub({ url: SITE, lang: 'es' }), /<html lang="es">[\s\S]*se mudó a/)
})

test('the stub script sends the reader to the translated or original hash', () => {
  const run = (html, hash) => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
    let to
    new Function('location', script)({ hash, replace: (u) => (to = u) })
    return to
  }
  const page = redirectStub({ url: `${SITE}guide/ai`, anchors: { 'with-botmesh-ai': 'with-@botmesh/ai', 'ai-plugin': '' } })
  assert.equal(run(page, ''), `${SITE}guide/ai`)
  assert.equal(run(page, '#with-botmesh-ai'), `${SITE}guide/ai#with-@botmesh/ai`)
  assert.equal(run(page, '#ai-plugin'), `${SITE}guide/ai`)
  assert.equal(run(page, '#ollama-local-or-cloud'), `${SITE}guide/ai#ollama-local-or-cloud`)
  const api = redirectStub({ url: `${SITE}api/core/classes/Bot`, lowerAnchors: true })
  assert.equal(run(api, '#Start'), `${SITE}api/core/classes/Bot#start`)
})

test('URLs and anchors are escaped in the HTML and the script', () => {
  const nasty = 'https://x.example/a"b<c>&d\'e</script>'
  const html = redirectStub({ url: nasty, anchors: { x: '</script><script>alert(1)' } })
  assert.ok(!html.includes('a"b<c>'))
  assert.equal(html.match(/<\/script>/g).length, 1)
  assert.match(html, /href="https:\/\/x\.example\/a&quot;b&lt;c&gt;&amp;d&#39;e&lt;\/script&gt;"/)
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  assert.equal(JSON.parse(scriptJson('</script>&\u2028')), '</script>&\u2028')
  assert.ok(!scriptJson('\u2028').includes('\u2028'))
  assert.ok(!scriptJson('</script>').includes('<'))
})

test('listHtml finds every HTML file, nested, with forward slashes', () => {
  const dir = join(root, 'dist')
  mkdirSync(join(dir, 'api', 'classes'), { recursive: true })
  for (const file of ['index.html', '404.html', 'api/classes/_botmesh_core.Bot.html', 'sitemap.xml']) writeFileSync(join(dir, file), '')
  assert.deepEqual(listHtml(dir), ['404.html', 'api/classes/_botmesh_core.Bot.html', 'index.html'])
})

test('docs:deploy options', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, forceBranch: false, redirects: false })
  assert.deepEqual(parseArgs(['--redirects', '--dry-run', '--force-branch']), { dryRun: true, forceBranch: true, redirects: true })
  assert.throws(() => parseArgs(['--push']), /unknown option --push/)
})

test('every page of the real docs/ maps to a page of its own language', () => {
  const real = loadSiteMap(fileURLToPath(new URL('../../docs', import.meta.url)))
  for (const page of real.pages) {
    const target = legacyTarget(`${page}.html`, real)
    assert.equal(target.kind, 'page', page)
    assert.equal(target.path.startsWith('/es'), page.startsWith('es/'), page)
  }
})
