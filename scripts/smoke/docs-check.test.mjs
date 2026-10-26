// Run with: pnpm test:scripts
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  anchorsOf,
  assetRefsOf,
  checkSite,
  detectBase,
  duplicates,
  linksOf,
  mermaidBlocks,
  repeatedHeadings,
  resolveLink,
  sidebarLinks,
  stripBase,
} from './docs-check.mjs'

test('collects element ids and <a> hrefs, decoding entities', () => {
  const html = '<h2 id="options">O</h2><a href="/guide/x?a=1&amp;b=2#c%C3%B3mo">x</a><link href="/assets/a.css"><a class="x" href="#top">t</a>'
  assert.deepEqual([...anchorsOf(html)], ['options'])
  assert.deepEqual(linksOf(html), ['/guide/x?a=1&b=2#c%C3%B3mo', '#top'])
})

test('resolves site links to dist files and decoded hashes', () => {
  assert.deepEqual(resolveLink('/guide/x#c%C3%B3mo', '/es/guide/y'), { file: 'guide/x.html', hash: 'cómo' })
  assert.deepEqual(resolveLink('#top', '/guide/y'), { file: 'guide/y.html', hash: 'top' })
  assert.deepEqual(resolveLink('/es/', '/guide/y'), { file: 'es/index.html', hash: '' })
  assert.deepEqual(resolveLink('/', '/guide/y'), { file: 'index.html', hash: '' })
  assert.deepEqual(resolveLink('/llms.txt', '/'), { file: 'llms.txt', hash: '' })
  assert.equal(resolveLink('https://example.com/a', '/'), null)
  assert.equal(resolveLink('mailto:a@b.c', '/'), null)
})

test('reads the sidebar links and finds duplicates', () => {
  const html = '<a href="/a">n</a><aside class="VPSidebar"><a href="/x">1</a><a href="/y">2</a><a href="/x">3</a></aside>'
  assert.deepEqual(sidebarLinks(html), ['/x', '/y', '/x'])
  assert.deepEqual(duplicates(['/x', '/y', '/x', '/x']), ['/x'])
})

test('counts mermaid fences and repeated headings outside code blocks', () => {
  const md = [
    '# T', '## Chatwoot', '### Options', '```mermaid', 'flowchart TD', '```',
    '## Tickets', '### Options', '```md', '### Options', '```', '````mermaid', 'graph LR', '````',
  ].join('\n')
  assert.equal(mermaidBlocks(md), 2)
  assert.deepEqual(repeatedHeadings(md), ['Options'])
  assert.deepEqual(repeatedHeadings('## A {#a}\n## A {#b}\n'), [])
})

test('checkSite reports broken links, missing anchors, sidebar duplicates and unrendered mermaid', () => {
  const root = mkdtempSync(join(tmpdir(), 'botwa-docs-check-'))
  try {
    const src = join(root, 'src')
    const dist = join(root, 'dist')
    mkdirSync(join(src, 'guide'), { recursive: true })
    mkdirSync(join(dist, 'guide'), { recursive: true })
    writeFileSync(join(src, 'guide/a.md'), '# A\n\n```mermaid\ngraph LR\n```\n\n## Same\n## Same\n')
    writeFileSync(join(src, 'guide/b.md'), '# B\n\n```mermaid\ngraph LR\n```\n')
    writeFileSync(join(dist, 'guide/a.html'),
      '<aside class="VPSidebar"><a href="/guide/a">a</a><a href="/guide/a">a</a></aside>'
      + '<h1 id="a">A</h1><div class="mermaid-diagram"></div>'
      + '<a href="/guide/b#b">ok</a><a href="/guide/b#nope">bad anchor</a><a href="/guide/c">bad page</a><a href="/api/">api</a>')
    writeFileSync(join(dist, 'guide/b.html'), '<h1 id="b">B</h1><pre><code class="language-mermaid">graph LR</code></pre>')
    const { errors, warnings } = checkSite({ distDir: dist, srcDir: src, ignore: [/^\/api\//] })
    assert.deepEqual(errors.sort(), [
      '/guide/a: duplicate sidebar link /guide/a',
      '/guide/a: missing anchor /guide/b#nope',
      '/guide/a: missing page /guide/c',
      '/guide/b: 1 mermaid block(s) in the source, 0 rendered diagram(s)',
    ])
    assert.deepEqual(warnings, ['guide/a.md: repeated heading "Same"'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolves links against a non-root base and flags absolute links that escape it', () => {
  const base = '/botmesh/'
  assert.deepEqual(resolveLink('/botmesh/guide/x#a', '/es/guide/y', base), { file: 'guide/x.html', hash: 'a' })
  assert.deepEqual(resolveLink('/botmesh/', '/guide/y', base), { file: 'index.html', hash: '' })
  assert.deepEqual(resolveLink('/botmesh', '/guide/y', base), { file: 'index.html', hash: '' })
  assert.deepEqual(resolveLink('/botmesh/api/', '/', base), { file: 'api/index.html', hash: '' })
  assert.deepEqual(resolveLink('./z', '/guide/y', base), { file: 'guide/z.html', hash: '' })
  assert.deepEqual(resolveLink('#top', '/guide/y', base), { file: 'guide/y.html', hash: 'top' })
  assert.deepEqual(resolveLink('/guide/x', '/guide/y', base), { outside: '/guide/x' })
  assert.deepEqual(resolveLink('/botmeshx/a', '/', base), { outside: '/botmeshx/a' })
  assert.equal(resolveLink('https://andresayac.github.io/botmesh/', '/', base), null)
  assert.equal(stripBase('/botmesh/api/x.html', base), '/api/x.html')
  assert.equal(stripBase('/botmesh', base), '/')
  assert.equal(stripBase('/other', base), null)
  assert.equal(stripBase('/guide/x', '/'), '/guide/x')
})

test('detects the base path from the built asset links', () => {
  assert.equal(detectBase('<link rel="stylesheet" href="/botmesh/assets/style.abc.css">'), '/botmesh/')
  assert.equal(detectBase('<script type="module" src="/assets/app.x.js"></script>'), '/')
  assert.equal(detectBase('<p>nothing</p>'), '/')
})

test('collects asset references (src of img/script/source, href of link)', () => {
  const html = '<link rel="stylesheet" href="/b/assets/s.css"><link rel="canonical" href="https://x.y/b/">'
    + '<script src="/b/assets/a.js"></script><img alt="x" src="/b/logo.svg"><a href="/b/guide/x">x</a>'
  assert.deepEqual(assetRefsOf(html), ['/b/assets/s.css', 'https://x.y/b/', '/b/assets/a.js', '/b/logo.svg'])
})

test('checkSite understands a non-root base', () => {
  const root = mkdtempSync(join(tmpdir(), 'botwa-docs-check-base-'))
  try {
    const src = join(root, 'src')
    const dist = join(root, 'dist')
    mkdirSync(join(src, 'guide'), { recursive: true })
    mkdirSync(join(dist, 'guide'), { recursive: true })
    mkdirSync(join(dist, 'assets'), { recursive: true })
    mkdirSync(join(dist, 'api'), { recursive: true })
    writeFileSync(join(dist, 'assets/s.css'), '')
    writeFileSync(join(dist, 'api/index.html'), '<h1 id="api">API</h1>')
    writeFileSync(join(src, 'guide/a.md'), '# A\n')
    writeFileSync(join(dist, 'index.html'), '<link rel="stylesheet" href="/botmesh/assets/s.css"><a href="/botmesh/guide/a#a">a</a>')
    writeFileSync(join(dist, 'guide/a.html'),
      '<link rel="stylesheet" href="/botmesh/assets/s.css"><script src="/botmesh/assets/missing.js"></script>'
      + '<h1 id="a">A</h1><a href="/botmesh/">home</a><a href="/botmesh/api/">api</a><a href="/botmesh/api/x.html">ignored</a>'
      + '<a href="/guide/a">root link</a><img src="/logo.svg">')
    const { errors } = checkSite({ distDir: dist, srcDir: src, base: '/botmesh/', ignore: [/^\/api\/x/] })
    assert.deepEqual(errors.sort(), [
      '/guide/a: link outside base /botmesh/: /guide/a',
      '/guide/a: link outside base /botmesh/: /logo.svg',
      '/guide/a: missing file /botmesh/assets/missing.js',
    ])
    // The same site checked as a root build sees every link as a missing page.
    assert.ok(checkSite({ distDir: dist, srcDir: src }).errors.some((e) => e.includes('missing page /botmesh/')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checkSite checks the absolute links of the TypeDoc pages against the base', () => {
  const root = mkdtempSync(join(tmpdir(), 'botwa-docs-check-api-'))
  try {
    const src = join(root, 'src')
    const dist = join(root, 'dist')
    mkdirSync(src, { recursive: true })
    mkdirSync(join(dist, 'guide'), { recursive: true })
    mkdirSync(join(dist, 'api', 'classes'), { recursive: true })
    writeFileSync(join(dist, 'guide/getting-started.html'), '<h1 id="x">X</h1>')
    writeFileSync(join(dist, 'api/classes/Bot.html'),
      '<a href="/botmesh/guide/getting-started">Guide</a><a href="../index.html">relative, not checked</a>'
      + '<a href="/guide/flows">escapes the base</a><a href="/botmesh/guide/nope">missing</a>')
    const { errors } = checkSite({ distDir: dist, srcDir: src, base: '/botmesh/' })
    assert.deepEqual(errors.sort(), [
      '/api/classes/Bot: link outside base /botmesh/: /guide/flows',
      '/api/classes/Bot: missing page /botmesh/guide/nope',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
