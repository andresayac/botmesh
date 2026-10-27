/**
 * site-map.mjs: where each VitePress page lands on the Mintlify site.
 *
 * Shared by the converter (mintlify/scripts/convert.mjs), which places the
 * pages and rewrites links with these rules, and by `pnpm docs:deploy
 * --redirects` (scripts/docs-redirects.mjs), which turns every old GitHub
 * Pages URL into a redirect stub pointing at the same page on Mintlify.
 * Node built-ins only: the root scripts import it without the mintlify/
 * tooling installed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

export const GITHUB = 'https://github.com/andresayac/botmesh'

/** Evaluates `const <name> = { ... } satisfies ...` from the VitePress config. */
export function readSidebar(source, name) {
  const start = source.indexOf(`const ${name} = `)
  const end = source.indexOf('satisfies DefaultTheme.SidebarMulti', start)
  if (start < 0 || end < 0) throw new Error(`cannot find ${name} in docs/.vitepress/config.ts`)
  const literal = source.slice(start + `const ${name} = `.length, end)
  // The sidebars are plain object literals (strings, arrays, objects): no code.
  return new Function(`return (${literal})`)()
}

/**
 * Loads the page layout of a VitePress `docs/` folder:
 * - `pages`: source pages, docs-relative without `.md` ('guide/flows', 'es/index');
 * - `outPage(page)`: published page path. Mintlify's language switcher only offers
 *   a translation that lives at the same path under the language prefix
 *   (`/guide/flows` <-> `/es/guide/flows`), so each Spanish page is published at
 *   its English counterpart's path, paired by position in the two sidebars (the
 *   same rule as docs/.vitepress/theme/langs.ts);
 * - `urlOf(page)`: Mintlify URL ('index' -> '/', 'es/index' -> '/es', 'guide/x' -> '/guide/x').
 */
export function loadSiteMap(docsDir) {
  const configTs = readFileSync(join(docsDir, '.vitepress', 'config.ts'), 'utf8')
  const sidebars = { en: readSidebar(configTs, 'enSidebar'), es: readSidebar(configTs, 'esSidebar') }

  /** link ('guide/flows') -> sidebar label. */
  const sidebarLabel = new Map()
  for (const lang of Object.values(sidebars)) {
    for (const groups of Object.values(lang)) {
      for (const group of groups) for (const item of group.items) sidebarLabel.set(item.link.slice(1), item.text)
    }
  }

  const pages = ['index', 'es/index']
  for (const dir of ['guide', 'examples', 'es/guide', 'es/ejemplos']) {
    const abs = join(docsDir, dir)
    if (!existsSync(abs)) continue
    for (const file of readdirSync(abs).sort()) if (file.endsWith('.md')) pages.push(`${dir}/${file.slice(0, -3)}`)
  }
  const pageSet = new Set(pages)

  const esTarget = new Map()
  const flat = (sb) => Object.values(sb).flatMap((groups) => groups.flatMap((g) => g.items.map((i) => i.link.slice(1))))
  const en = flat(sidebars.en)
  const es = flat(sidebars.es)
  if (en.length !== es.length) throw new Error(`sidebars out of sync: ${en.length} English vs ${es.length} Spanish pages`)
  es.forEach((page, i) => esTarget.set(page, `es/${en[i]}`))

  const outPage = (page) => esTarget.get(page) ?? page
  const urlOf = (page) => '/' + outPage(page).replace(/(^|\/)index$/, '').replace(/\/$/, '')

  /**
   * A docs-relative path (no leading slash, `.md`/`.html` and a trailing `/`
   * allowed) -> `{ page }` for a published page, `{ github }` for a file of the
   * repository the site does not publish (linked on GitHub, as VitePress clean
   * URLs drop `.md`), or `null`.
   */
  const resolveDocPath = (abs) => {
    let target = abs.replace(/\.(md|html)$/, '').replace(/\/$/, '/index')
    if (target === '' || target === '.') target = 'index'
    if (!pageSet.has(target) && pageSet.has(`${target}/index`)) target = `${target}/index`
    if (pageSet.has(target)) return { page: target }
    const repoPath = posix.normalize(posix.join('docs', abs))
    // An old `.html` URL of an unpublished page (`MIGRATION-v1-to-v2.html`) is its `.md` source.
    for (const file of [repoPath, `${repoPath.replace(/\.html$/, '')}.md`]) {
      if (!file.startsWith('..') && isFile(join(docsDir, '..', file))) return { github: `${GITHUB}/blob/main/${file}` }
    }
    return null
  }

  return { sidebars, sidebarLabel, pages, pageSet, esTarget, outPage, urlOf, resolveDocPath }
}

const isFile = (path) => existsSync(path) && statSync(path).isFile()

// ---------------------------------------------------------------- API reference

/** TypeDoc HTML folder -> typedoc-plugin-markdown folder. */
export const KIND_DIRS = { classes: 'classes', interfaces: 'interfaces', functions: 'functions', types: 'type-aliases', variables: 'variables', enums: 'enumerations' }
/** TypeDoc HTML module name -> Mintlify folder (its landing page is `<dir>/index.mdx`). */
export const MODULE_DIRS = { _botmesh_core: 'api/core', _botmesh_core_spi: 'api/core/spi', _botmesh_core_testing: 'api/core/testing' }
export const API_HOME = 'api/core'

/**
 * A TypeDoc HTML path (`/api/classes/_botmesh_core.Bot.html`) -> the Mintlify
 * page it becomes: `{ page, module }` for a reflection page (`module` is the
 * fallback when that page was not generated), `{ module }` for a module page,
 * `{ home: true }` for the API landing and `null` for anything else.
 */
export function apiTarget(path) {
  const m = /^\/api\/(\w+)\/(_botmesh_core(?:_spi|_testing)?)\.([^./]+)\.html$/.exec(path)
  if (m && KIND_DIRS[m[1]]) return { page: `${MODULE_DIRS[m[2]]}/${KIND_DIRS[m[1]]}/${m[3]}`, module: MODULE_DIRS[m[2]] }
  const mod = /^\/api\/modules\/(_botmesh_core(?:_spi|_testing)?)\.html$/.exec(path)
  if (mod) return { module: MODULE_DIRS[mod[1]] }
  if (path === '/api/' || path === '/api' || path === '/api/index.html') return { home: true }
  return null
}

// ---------------------------------------------------------------- old GitHub Pages URLs

/**
 * Where an old GitHub Pages path goes on the Mintlify site. `rel` is relative
 * to the site base, without a leading slash ('guide/flows.html', 'es/',
 * 'api/classes/_botmesh_core.Bot.html', '404.html'). Returns
 * `{ kind, path, page? }`: `kind` is 'page' (a converted page; `page` is its
 * source, for anchor translation), 'api' (a reference page; anchors are
 * lowercased, as the converter pins member ids), 'github' (`path` is an
 * absolute GitHub URL) or 'home' (unmapped: the Mintlify home, or `/es` for a
 * Spanish path). `hasPage(page)` tells whether a Mintlify API page was generated.
 */
export function legacyTarget(rel, map, { hasPage = () => true } = {}) {
  const clean = rel.replace(/^\/+/, '')
  const home = { kind: 'home', path: clean === 'es' || clean.startsWith('es/') ? '/es' : '/' }
  if (clean === '404.html') return { kind: 'home', path: '/' }
  if (clean === 'api' || clean.startsWith('api/')) {
    const api = apiTarget(`/${clean}`)
    if (!api) return { kind: 'api', path: `/${API_HOME}` }
    if (api.page && hasPage(api.page)) return { kind: 'api', path: `/${api.page}` }
    return { kind: 'api', path: `/${api.module ?? API_HOME}` }
  }
  const resolved = map.resolveDocPath(clean)
  if (resolved?.page) return { kind: 'page', path: map.urlOf(resolved.page), page: resolved.page }
  if (resolved?.github) return { kind: 'github', path: resolved.github }
  return home
}
