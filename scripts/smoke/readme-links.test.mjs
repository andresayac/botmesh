// Run with: pnpm test:scripts
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_SITE_URL, SITE_URL, loadSiteMap } from '../../mintlify/scripts/site-map.mjs'
import { relativeLinks, siteLinks } from './readme-links.mjs'

const root = join(import.meta.dirname, '..', '..')

test('flags relative markdown, reference and HTML links', () => {
  const md = [
    'See [the example](examples/bot.ts) and [guide](./docs/x.md).',
    '![logo](logo.png)',
    '[ref]: ../CHANGELOG.md',
    '<a href="LICENSE">license</a> <img src="img/a.svg">',
  ].join('\n')
  assert.deepEqual(relativeLinks(md), ['examples/bot.ts', './docs/x.md', 'logo.png', '../CHANGELOG.md', 'LICENSE', 'img/a.svg'])
})

test('accepts absolute URLs, anchors and mailto', () => {
  const md = [
    '[gh](https://github.com/a/b/blob/main/examples/bot.ts) [npm](http://npmjs.com)',
    '[top](#install) [mail](mailto:a@b.c)',
    '[ref]: https://example.com/x',
    '<a href="https://x.y">x</a>',
  ].join('\n')
  assert.deepEqual(relativeLinks(md), [])
})

test('ignores links inside code blocks and inline code', () => {
  const md = ['```ts', "const x = '[a](b.ts)'", '```', 'Use `[x](y.md)` literally.'].join('\n')
  assert.deepEqual(relativeLinks(md), [])
})

test('siteLinks extracts the paths of the docs site links', () => {
  const md = 'See <https://docs.x/>, [ai](https://docs.x/guide/ai#tools). Also https://docs.x/es/guide/flows. And https://other.y/guide/z'
  assert.deepEqual(siteLinks(md, 'https://docs.x/'), ['/', '/guide/ai', '/es/guide/flows'])
})

test('READMEs, homepages and llms.txt link the docs site with paths it publishes', () => {
  const map = loadSiteMap(join(root, 'docs'))
  const published = new Set(map.pages.map((page) => map.urlOf(page)))
  const files = ['README.md', 'docs/public/llms.txt']
  for (const dir of readdirSync(join(root, 'packages'))) {
    for (const name of ['README.md', 'package.json']) if (existsSync(join(root, 'packages', dir, name))) files.push(`packages/${dir}/${name}`)
  }
  const problems = []
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8')
    if (text.includes(LEGACY_SITE_URL)) problems.push(`${file}: links the old GitHub Pages site (${LEGACY_SITE_URL}); use ${SITE_URL}`)
    if (text.includes('mintlify.app')) problems.push(`${file}: links the Mintlify subdomain; use ${SITE_URL}`)
    for (const path of siteLinks(text, SITE_URL)) {
      if (!published.has(path) && !/^\/api\/core(\/|$)/.test(path)) problems.push(`${file}: ${SITE_URL}${path.slice(1)} is not a page of the site`)
    }
  }
  assert.deepEqual(problems, [])
})
