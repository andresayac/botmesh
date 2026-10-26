// Checks the built docs site (docs/dist) for broken internal links and
// anchors, duplicated sidebar entries, ```mermaid blocks that were not turned
// into diagrams and repeated headings (ambiguous `#options-1` style anchors).
// Local tool, not part of CI. Run after `pnpm run docs:site` (or `pnpm run docs`):
//   pnpm docs:check
// The site may be built under a sub-path (`DOCS_BASE=/botmesh/` for GitHub
// Pages). The base is taken from `--base=/x/`, then `DOCS_BASE`, then the asset
// links of dist/index.html; an absolute link that escapes it is an error.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const decodeEntities = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Every `id="…"` in an HTML document. */
export function anchorsOf(html) {
  return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => decodeEntities(m[1])))
}

/** The `href` of every `<a>` element, entity-decoded. */
export function linksOf(html) {
  return [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((m) => decodeEntities(m[1]))
}

/** `src` of img/script/source/iframe elements and `href` of `<link>` elements. */
export function assetRefsOf(html) {
  return [
    ...html.matchAll(/<(?:link\b[^>]*?\shref|(?:img|script|source|iframe)\b[^>]*?\ssrc)="([^"]*)"/g),
  ].map((m) => decodeEntities(m[1]))
}

/** The base path a site was built with, read from its asset links (`/` when unknown). */
export function detectBase(html) {
  const m = /\s(?:href|src)="(\/[^"]*?)assets\/[^"]*\.(?:css|js)"/.exec(html)
  return m ? m[1] : '/'
}

/** `pathname` relative to the site root (`/botmesh/x` -> `/x`), or `null` when it is outside `base`. */
export function stripBase(pathname, base = '/') {
  if (base === '/') return pathname
  if (pathname === base.slice(0, -1)) return '/'
  return pathname.startsWith(base) ? pathname.slice(base.length - 1) : null
}

/** The links rendered inside the sidebar (`<aside class="VPSidebar…">`). */
export function sidebarLinks(html) {
  const start = html.search(/<aside\b[^>]*class="[^"]*VPSidebar/)
  if (start < 0) return []
  const end = html.indexOf('</aside>', start)
  return linksOf(html.slice(start, end < 0 ? undefined : end))
}

export function duplicates(items) {
  const seen = new Set()
  const dup = new Set()
  for (const item of items) (seen.has(item) ? dup : seen).add(item)
  return [...dup]
}

/** Maps a page route (`/guide/x`, `/es/`) to its file under dist. */
function routeToFile(pathname) {
  if (pathname.endsWith('/')) return `${pathname.slice(1)}index.html`
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return last.includes('.') ? pathname.slice(1) : `${pathname.slice(1)}.html`
}

/**
 * Resolves a link found on the page at `fromRoute` (a route relative to the
 * site root, without the base) to `{ file, hash }` relative to dist, to
 * `{ outside: pathname }` when an absolute path escapes `base`, or to `null`
 * when it leaves the site.
 */
export function resolveLink(href, fromRoute, base = '/') {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null
  const url = new URL(href, `http://docs.local${base}${fromRoute.slice(1)}`)
  const pathname = stripBase(url.pathname, base)
  if (pathname === null) return { outside: url.pathname }
  return { file: safeDecode(routeToFile(pathname)), hash: safeDecode(url.hash.slice(1)) }
}

/** Splits markdown into lines outside fenced code, plus the info string of each fence. */
function scanMarkdown(md) {
  const text = []
  const fences = []
  let open = null
  for (const line of md.split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    if (open) {
      if (m && m[1][0] === open[0] && m[1].length >= open.length && line.trim() === m[1]) open = null
      continue
    }
    if (m) {
      open = m[1]
      fences.push(m[2])
      continue
    }
    text.push(line)
  }
  return { text, fences }
}

/** Number of ```mermaid fences in a markdown page. */
export function mermaidBlocks(md) {
  return scanMarkdown(md).fences.filter((info) => info === 'mermaid').length
}

/**
 * Heading texts that appear more than once on a page. VitePress gives the
 * copies `-1`, `-2` anchors, which read the same in the outline and break
 * when sections move. Headings with an explicit `{#id}` are skipped.
 */
export function repeatedHeadings(md) {
  const texts = []
  for (const line of scanMarkdown(md).text) {
    const m = /^#{2,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (m && !/\{#[^}]+\}\s*$/.test(m[1])) texts.push(m[1])
  }
  return duplicates(texts)
}

/**
 * 1-based line numbers whose `{{ }}` Vue would interpolate: VitePress compiles each
 * page as a Vue template, so a mustache outside a code fence (inline code included)
 * renders empty or breaks the page's SSR. `<code v-pre>…</code>` keeps it literal.
 */
export function unescapedMustaches(md) {
  const lines = []
  let open = null
  md.split(/\r?\n/).forEach((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open) {
      if (m && m[1][0] === open[0] && m[1].length >= open.length && line.trim() === m[1]) open = null
      return
    }
    if (m) {
      open = m[1]
      return
    }
    if (line.replace(/<code v-pre>[\s\S]*?<\/code>/g, '').includes('{{')) lines.push(i + 1)
  })
  return lines
}

function walk(dir, skip, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, skip, out)
    else out.push(full)
  }
  return out
}

const toPosix = (p) => p.split(sep).join('/')

function fileToRoute(file) {
  if (file === 'index.html') return '/'
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`
  return `/${file.replace(/\.html$/, '')}`
}

/**
 * Checks a built site. `ignore` lists patterns matched against a link's
 * pathname relative to the site root (e.g. `/api/` when the TypeDoc output is
 * not in dist). `base` is the public path the site was built with.
 */
export function checkSite({ distDir, srcDir, ignore = [], base = '/' }) {
  const errors = []
  const warnings = []
  const htmlCache = new Map()
  const readHtml = (file) => {
    if (!htmlCache.has(file)) htmlCache.set(file, readFileSync(join(distDir, file), 'utf8'))
    return htmlCache.get(file)
  }

  const pages = walk(distDir, new Set(['api', 'assets']))
    .map((f) => toPosix(relative(distDir, f)))
    .filter((f) => f.endsWith('.html'))
  for (const file of pages) {
    const route = fileToRoute(file)
    const html = readHtml(file)
    for (const link of duplicates(sidebarLinks(html))) errors.push(`${route}: duplicate sidebar link ${link}`)
    const reported = new Set()
    const report = (msg) => {
      if (!reported.has(msg)) errors.push(msg)
      reported.add(msg)
    }
    const refs = [...linksOf(html).map((href) => [href, 'page']), ...assetRefsOf(html).map((href) => [href, 'file'])]
    for (const [href, kind] of refs) {
      const target = resolveLink(href, route, base)
      if (!target) continue
      if (target.outside) {
        report(`${route}: link outside base ${base}: ${target.outside}`)
        continue
      }
      const shown = new URL(href, `http://docs.local${base}${route.slice(1)}`).pathname
      if (ignore.some((re) => re.test(stripBase(shown, base)))) continue
      if (!existsSync(join(distDir, target.file))) {
        report(`${route}: missing ${kind} ${shown}`)
        continue
      }
      if (target.hash && target.file.endsWith('.html') && !anchorsOf(readHtml(target.file)).has(target.hash)) {
        report(`${route}: missing anchor ${shown}#${target.hash}`)
      }
    }
  }

  // The TypeDoc reference only uses relative links, except the header links
  // (scripts/typedoc-docs.cjs) and absolute paths written in doc comments.
  const apiDir = join(distDir, 'api')
  const apiPages = existsSync(apiDir)
    ? walk(apiDir, new Set(['assets'])).map((f) => toPosix(relative(distDir, f))).filter((f) => f.endsWith('.html'))
    : []
  for (const file of apiPages) {
    const route = fileToRoute(file)
    const reported = new Set()
    for (const href of linksOf(readFileSync(join(distDir, file), 'utf8'))) {
      if (!href.startsWith('/') || href.startsWith('//')) continue
      const target = resolveLink(href, route, base)
      const msg = target.outside
        ? `${route}: link outside base ${base}: ${target.outside}`
        : !existsSync(join(distDir, target.file))
          ? `${route}: missing page ${new URL(href, 'http://docs.local').pathname}`
          : null
      if (msg && !reported.has(msg)) errors.push(msg)
      if (msg) reported.add(msg)
    }
  }

  const sources = walk(srcDir, new Set(['dist', 'api', 'node_modules', '.vitepress', 'public']))
    .map((f) => toPosix(relative(srcDir, f)))
    .filter((f) => f.endsWith('.md'))
  for (const file of sources) {
    const md = readFileSync(join(srcDir, file), 'utf8')
    for (const text of repeatedHeadings(md)) warnings.push(`${file}: repeated heading "${text}"`)
    const expected = mermaidBlocks(md)
    const htmlFile = file.replace(/\.md$/, '.html')
    // Pages excluded from the site (srcExclude) are never compiled by Vue.
    if (!existsSync(join(distDir, htmlFile))) continue
    for (const line of unescapedMustaches(md)) {
      errors.push(`${file}:${line}: {{ }} outside a code fence is interpolated by Vue (use <code v-pre>…</code>)`)
    }
    const html = readHtml(htmlFile)
    const rendered = (html.match(/class="mermaid-diagram\b/g) ?? []).length
    const raw = (html.match(/class="language-mermaid\b/g) ?? []).length
    if (expected !== rendered || raw > 0) {
      errors.push(`${fileToRoute(htmlFile)}: ${expected} mermaid block(s) in the source, ${rendered} rendered diagram(s)`)
    }
  }
  return { errors, warnings }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../../docs/', import.meta.url))
  const distDir = join(root, 'dist')
  if (!existsSync(distDir)) {
    console.error('docs/dist not found: run `pnpm run docs:site` first')
    process.exit(1)
  }
  const arg = process.argv.slice(2).find((a) => a.startsWith('--base='))
  const index = join(distDir, 'index.html')
  const base =
    arg?.slice('--base='.length) ||
    process.env.DOCS_BASE ||
    (existsSync(index) ? detectBase(readFileSync(index, 'utf8')) : '/')
  if (!/^\/(.*\/)?$/.test(base)) {
    console.error(`docs-check: the base must start and end with "/" (got ${JSON.stringify(base)})`)
    process.exit(1)
  }
  // Links into the TypeDoc reference are only checkable after `pnpm run docs`.
  const ignore = existsSync(join(distDir, 'api')) ? [] : [/^\/api\//]
  const { errors, warnings } = checkSite({ distDir, srcDir: root, ignore, base })
  for (const w of warnings) console.warn(`warning: ${w}`)
  for (const e of errors) console.error(`error: ${e}`)
  console.log(`docs-check (base ${base}): ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(errors.length > 0 ? 1 : 0)
}
