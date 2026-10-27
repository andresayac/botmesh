#!/usr/bin/env node
/**
 * convert.mjs: rebuild the Mintlify site (mintlify/site/, git-ignored) from the
 * VitePress sources in docs/ and the TypeDoc reference of @botmesh/core.
 *
 * The VitePress pages stay the single source of truth: never edit
 * mintlify/site/ by hand, change docs/ and run this script again.
 *
 *   node mintlify/scripts/convert.mjs              # pages + API reference + docs.json
 *   node mintlify/scripts/convert.mjs --skip-api   # reuse the API pages already in site/api
 *   node mintlify/scripts/convert.mjs --llms-base https://botmesh.mintlify.app/
 *       # also publish docs/public/llms.txt with its GitHub Pages links rewritten
 *
 * What it does:
 * - Navigation: reads the English and Spanish sidebars straight from
 *   docs/.vitepress/config.ts and emits docs.json with one language per locale
 *   and the tabs Guide / Examples / API reference (same groups, same order).
 * - Pages: the first `# H1` becomes `title`, the sidebar label `sidebarTitle`
 *   and a short link-free lead paragraph `description` (llms.txt and SEO use
 *   it). Spanish pages are published at their English counterpart's path
 *   under /es/ (Mintlify's language switcher needs mirrored paths), with
 *   redirects from the old Spanish slugs. Anchor links are translated from
 *   VitePress slugs to Mintlify slugs.
 *   `::: tip|warning|danger|info|details` containers become <Tip>, <Warning>,
 *   <Danger>, <Info> and <Accordion>; ```mermaid fences are kept (Mintlify
 *   renders them natively); links are rewritten to absolute Mintlify paths;
 *   `{`, `}` and `<` in prose are escaped so every page compiles as MDX.
 * - Home pages: the VitePress `layout: home` hero/features become cards.
 * - API: TypeDoc + typedoc-plugin-markdown over the same entry points as
 *   `pnpm docs:api` (packages/core/typedoc.json), moved to site/api/core/.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sindreSlugify from '@sindresorhus/slugify'
import YAML from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const tooling = resolve(here, '..')
const repo = resolve(tooling, '..')
const docs = join(repo, 'docs')
const site = join(tooling, 'site')
const apiCache = join(tooling, '.cache', 'api')

const args = process.argv.slice(2)
const skipApi = args.includes('--skip-api')
const llmsAt = args.indexOf('--llms-base')
const llmsBase = llmsAt >= 0 ? args[llmsAt + 1] : undefined

const GITHUB = 'https://github.com/andresayac/botmesh'
const NPM = 'https://www.npmjs.com/package/@botmesh/core'
const warnings = []
const warn = (msg) => warnings.push(msg)

// ---------------------------------------------------------------- sidebars

/** Evaluates `const <name> = { ... } satisfies ...` from the VitePress config. */
function readSidebar(source, name) {
  const start = source.indexOf(`const ${name} = `)
  const end = source.indexOf('satisfies DefaultTheme.SidebarMulti', start)
  if (start < 0 || end < 0) throw new Error(`cannot find ${name} in docs/.vitepress/config.ts`)
  const literal = source.slice(start + `const ${name} = `.length, end)
  // The sidebars are plain object literals (strings, arrays, objects): no code.
  return new Function(`return (${literal})`)()
}

const configTs = readFileSync(join(docs, '.vitepress', 'config.ts'), 'utf8')
const sidebars = { en: readSidebar(configTs, 'enSidebar'), es: readSidebar(configTs, 'esSidebar') }

/** link ('/guide/flows') -> sidebar label, for `sidebarTitle`. */
const sidebarLabel = new Map()
for (const lang of Object.values(sidebars)) {
  for (const groups of Object.values(lang)) {
    for (const group of groups) for (const item of group.items) sidebarLabel.set(item.link.slice(1), item.text)
  }
}

// ---------------------------------------------------------------- pages

/** Source pages: docs-relative path without `.md` ('guide/flows', 'es/index'). */
function listPages() {
  const out = ['index', 'es/index']
  for (const dir of ['guide', 'examples', 'es/guide', 'es/ejemplos']) {
    for (const file of readdirSync(join(docs, dir))) if (file.endsWith('.md')) out.push(`${dir}/${file.slice(0, -3)}`)
  }
  return out
}
const pages = listPages()
const pageSet = new Set(pages)

/** Mintlify URL of a page ('index' -> '/', 'es/index' -> '/es', 'guide/x' -> '/guide/x'). */
/**
 * Mintlify's language switcher only offers a translation that lives at the same
 * path under the language prefix (`/guide/flows` <-> `/es/guide/flows`) and
 * greys the option out otherwise. The Spanish pages use Spanish slugs, so each
 * one is published at its English counterpart's path, paired by position in
 * the two sidebars (the same rule as docs/.vitepress/theme/langs.ts). The old
 * Spanish URLs get redirects in docs.json.
 */
const esTarget = new Map()
{
  const flat = (sb) => Object.values(sb).flatMap((groups) => groups.flatMap((g) => g.items.map((i) => i.link.slice(1))))
  const en = flat(sidebars.en)
  const es = flat(sidebars.es)
  if (en.length !== es.length) throw new Error(`sidebars out of sync: ${en.length} English vs ${es.length} Spanish pages`)
  es.forEach((page, i) => esTarget.set(page, `es/${en[i]}`))
}
/** Source page -> published page path. */
const outPage = (page) => esTarget.get(page) ?? page
const urlOf = (page) => '/' + outPage(page).replace(/(^|\/)index$/, '').replace(/\/$/, '')

// ---------------------------------------------------------------- API link map

/** TypeDoc HTML folder -> markdown folder. */
const KIND_DIRS = { classes: 'classes', interfaces: 'interfaces', functions: 'functions', types: 'type-aliases', variables: 'variables', enums: 'enumerations' }
const MODULE_DIRS = { _botmesh_core: 'api/core', _botmesh_core_spi: 'api/core/spi', _botmesh_core_testing: 'api/core/testing' }
// Module landing pages live at <dir>/index.mdx; links use the bare directory.
const apiPages = new Set()

/** `/api/...` (TypeDoc HTML URL) -> Mintlify path of the generated page. */
function mapApiLink(href) {
  const [path, hash] = href.split('#')
  const m = /^\/api\/(\w+)\/(_botmesh_core(?:_spi|_testing)?)\.([^./]+)\.html$/.exec(path)
  if (m && KIND_DIRS[m[1]]) {
    const target = `${MODULE_DIRS[m[2]]}/${KIND_DIRS[m[1]]}/${m[3]}`
    if (!skipApi && !apiPages.has(target)) warn(`API link ${href}: no generated page ${target}, linking the module index`)
    const final = skipApi || apiPages.has(target) ? `/${target}` : `/${MODULE_DIRS[m[2]]}`
    return hash ? `${final}#${hash.toLowerCase()}` : final
  }
  const mod = /^\/api\/modules\/(_botmesh_core(?:_spi|_testing)?)\.html$/.exec(path)
  if (mod) return `/${MODULE_DIRS[mod[1]]}`
  if (path === '/api/' || path === '/api' || path === '/api/index.html') return '/api/core'
  warn(`unmapped API link ${href}`)
  return '/api/core'
}

// ---------------------------------------------------------------- links

// ---------------------------------------------------------------- heading anchors

/**
 * VitePress and Mintlify slug headings differently (`## With @botmesh/ai` is
 * `#with-botmesh-ai` in VitePress and `#with-@botmesh/ai` in Mintlify), so
 * every anchor link is translated through a per-page table built from the
 * headings of the source pages.
 */
function headingText(raw) {
  return raw
    .replace(/\s*\{#[\w-]+\}\s*$/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|])/g, '$1')
    .trim()
}

/** markdown-it-anchor + @mdit-vue/shared slugify, as VitePress uses them. */
function vitepressSlug(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
}

/** @mintlify/common slugify (getUnicodeId + @sindresorhus/slugify), cleaned like the rendered DOM id. */
function mintlifySlug(text) {
  const encoded = encodeURIComponent(text.toLowerCase().trim().replace(/\s+/g, '-'))
  const slug = /%[0-9A-F]{2}/.test(encoded)
    ? sindreSlugify(encoded, { decamelize: false, preserveCharacters: ['%', '_'], lowercase: false })
    : sindreSlugify(encoded, { decamelize: false, preserveCharacters: ['_'] })
  return cleanId(slug)
}

function cleanId(id) {
  let decoded = id
  try { decoded = decodeURIComponent(id) } catch {}
  return decoded
    .replace(/[?,;:!'"()[\]{}]/g, '')
    .replace(/\p{Emoji_Modifier}|\p{Emoji_Modifier_Base}|\p{Emoji_Presentation}|\p{Extended_Pictographic}|[\u200D\uFE0E\uFE0F]/gu, '')
}

/** page -> Map(VitePress anchor -> Mintlify anchor, '' for the page title). */
const anchors = new Map()

function collectAnchors(page, body) {
  const map = new Map()
  const vpSeen = new Set()
  const mintSeen = new Map()
  const dedupeMint = (slug) => {
    const count = mintSeen.get(slug) ?? 0
    mintSeen.set(slug, count + 1)
    if (count === 0) return slug
    let n = count + 1
    while (mintSeen.has(`${slug}-${n}`)) n++
    mintSeen.set(`${slug}-${n}`, 1)
    return `${slug}-${n}`
  }
  let fence = null
  let first = true
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      continue
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line)
    if (open) { fence = open[1]; continue }
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!h) continue
    const custom = /\{#([\w-]+)\}\s*$/.exec(h[2])
    const text = headingText(h[2])
    let vp = custom ? custom[1] : vitepressSlug(text)
    if (!custom) {
      let unique = vp
      for (let i = 1; vpSeen.has(unique); i++) unique = `${vp}-${i}`
      vp = unique
    }
    vpSeen.add(vp)
    if (h[1] === '#' && first) {
      // The H1 becomes the front-matter title: links to it land on the page top.
      map.set(vp, '')
      first = false
      continue
    }
    map.set(vp, custom ? dedupeMint(cleanId(custom[1])) : dedupeMint(mintlifySlug(text)))
  }
  anchors.set(page, map)
}

function mapAnchor(target, hash, from) {
  if (!hash) return ''
  const table = anchors.get(target)
  let key = hash
  try { key = decodeURIComponent(hash) } catch {}
  if (!table) return `#${hash}`
  if (table.has(key)) {
    const a = table.get(key)
    return a ? `#${a}` : ''
  }
  warn(`${from}: anchor #${hash} not found on ${target}`)
  return `#${hash}`
}

function rewriteHref(href, page) {
  if (/^(https?:|mailto:|tel:)/.test(href)) return href
  if (href.startsWith('#')) return mapAnchor(page, href.slice(1), page) || '#'
  if (href.startsWith('/api/') || href === '/api') return mapApiLink(href)
  const [path, hash] = href.split('#')
  // Resolve relative to the source file inside docs/.
  const abs = path.startsWith('/') ? path.slice(1) : posix.normalize(posix.join(posix.dirname(page), path))
  let target = abs.replace(/\.(md|html)$/, '').replace(/\/$/, '/index')
  if (target === '' || target === '.') target = 'index'
  if (!pageSet.has(target) && pageSet.has(`${target}/index`)) target = `${target}/index`
  if (pageSet.has(target)) return urlOf(target) + mapAnchor(target, hash, page)
  // A file of the repository that the site does not publish: link it on GitHub.
  const repoPath = posix.normalize(posix.join('docs', abs))
  // VitePress clean URLs drop `.md` (`/MIGRATION-v1-to-v2`), so try the source file too.
  for (const file of [repoPath, `${repoPath}.md`]) {
    if (!file.startsWith('..') && existsSync(join(repo, file))) {
      return `${GITHUB}/blob/main/${file}${hash ? `#${hash}` : ''}`
    }
  }
  warn(`${page}: link target not found: ${href}`)
  return href
}

// ---------------------------------------------------------------- MDX escaping

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }
const decodeEntities = (s) => s.replace(/&(?:lt|gt|quot|#39|amp);/g, (e) => ENTITIES[e])

/** Wraps text in a Markdown code span whose fence is longer than any backtick run inside. */
function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/**
 * Escapes the characters MDX would read as JSX or expressions (`{`, `}`, `<`)
 * in a block of prose, leaving inline code spans untouched, and rewrites the
 * link targets of `[text](href)` (and `![alt](src)`).
 */
function convertProse(text, page) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '`') {
      let n = 0
      while (text[i + n] === '`') n++
      const fence = '`'.repeat(n)
      // A code span closes on a run of exactly the same length.
      let j = i + n
      let close = -1
      while ((j = text.indexOf(fence, j)) >= 0) {
        if (text[j + n] !== '`' && text[j - 1] !== '`') { close = j; break }
        while (text[j] === '`') j++
      }
      if (close >= 0) {
        out += text.slice(i, close + n)
        i = close + n
        continue
      }
      out += fence
      i += n
      continue
    }
    if (ch === '\\' && i + 1 < text.length) {
      // Keep existing escapes as they are.
      out += text.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === ']' && text[i + 1] === '(') {
      // Link target: find the matching ')' (no nesting in these docs).
      const close = text.indexOf(')', i + 2)
      if (close > 0) {
        const raw = text.slice(i + 2, close)
        const m = /^(\S+)(\s+"[^"]*")?$/.exec(raw)
        if (m) {
          out += `](${rewriteHref(m[1], page)}${m[2] ?? ''})`
          i = close + 1
          continue
        }
      }
    }
    if (ch === '<') {
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i)
        const body = text.slice(i + 4, end < 0 ? text.length : end).replace(/\*\//g, '* /')
        out += `{/*${body}*/}`
        i = end < 0 ? text.length : end + 3
        continue
      }
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(text.slice(i))
      if (auto) {
        out += `[${auto[1]}](${auto[1]})`
        i += auto[0].length
        continue
      }
      // `<code v-pre>{{ path }}</code>` (VitePress needs v-pre so Vue leaves the
      // braces alone) -> a Markdown code span, which MDX never evaluates.
      const code = /^<code(?:\s+v-pre)?>([^<]*)<\/code>/.exec(text.slice(i))
      if (code) {
        out += codeSpan(decodeEntities(code[1]))
        i += code[0].length
        continue
      }
      const br = /^<br\s*\/?>/i.exec(text.slice(i))
      if (br) {
        out += '<br />'
        i += br[0].length
        continue
      }
      out += '&lt;'
      i++
      continue
    }
    if (ch === '{' || ch === '}') {
      // A trailing `{#custom-id}` on a heading is Mintlify syntax: keep it.
      const rest = text.slice(i)
      if (ch === '{' && /^\{#[\w-]+\}\s*$/.test(rest.split('\n')[0])) {
        const line = rest.split('\n')[0]
        out += line
        i += line.length
        continue
      }
      out += `\\${ch}`
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

// ---------------------------------------------------------------- markdown -> MDX

const CALLOUTS = { tip: 'Tip', warning: 'Warning', danger: 'Danger', info: 'Info', note: 'Note', details: 'Accordion' }

function plainText(md) {
  return md
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)_([^_]+)_(\W|$)/g, '$1$2$3')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function frontMatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}

/** Splits `---\nyaml\n---\nbody`. */
function splitFrontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  return m ? { data: YAML.parse(m[1]) ?? {}, body: src.slice(m[0].length) } : { data: {}, body: src }
}

function convertMarkdown(body, page) {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let title
  let description
  let fence = null // { char, len }
  let para = [] // prose lines waiting to be escaped together (multi-line code spans)
  const stack = []

  const flush = () => {
    if (para.length === 0) return
    out.push(convertProse(para.join('\n'), page))
    para = []
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    if (fence) {
      out.push(line)
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null
      continue
    }
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (open) {
      flush()
      fence = { char: open[2][0], len: open[2].length }
      out.push(line)
      continue
    }
    const container = /^(\s*):::\s*([a-z-]+)\s*(.*)$/.exec(line)
    if (container) {
      flush()
      const [, indent, kind, label] = container
      const tag = CALLOUTS[kind]
      if (!tag) {
        warn(`${page}: unsupported container ::: ${kind}, kept as a Note`)
      }
      const name = tag ?? 'Note'
      stack.push(name)
      if (name === 'Accordion') {
        const t = plainText(label || 'Details').replace(/"/g, '&quot;')
        out.push(`${indent}<Accordion title="${t}">`, '')
      } else {
        out.push(`${indent}<${name}>`, '')
        if (label) out.push(`${indent}**${convertProse(label, page)}**`, '')
      }
      continue
    }
    if (/^\s*:::\s*$/.test(line)) {
      flush()
      const name = stack.pop()
      if (!name) {
        warn(`${page}: stray ::: closer at line ${idx + 1}`)
        continue
      }
      const indent = /^(\s*)/.exec(line)[1]
      out.push('', `${indent}</${name}>`)
      continue
    }
    if (title === undefined && /^#\s+/.test(line)) {
      flush()
      title = line.replace(/^#\s+/, '').replace(/\s*\{#[\w-]+\}\s*$/, '').trim()
      continue
    }
    if (line.trim() === '') {
      flush()
      out.push(line)
      continue
    }
    // First plain paragraph after the title: the page description.
    // Mintlify prints `description` under the title, so a lead paragraph that
    // fits (no links, at most 300 characters, the llms.txt limit) moves there
    // instead of being shown twice. Longer or linked leads stay in the body and
    // the page gets no description.
    if (title !== undefined && description === undefined && para.length === 0 && out.every((l) => l.trim() === '')) {
      let j = idx
      const buf = []
      while (j < lines.length && lines[j].trim() !== '' && !/^\s*(```|~~~|:::|#|\||[-*+] |\d+\. |>|<)/.test(lines[j])) buf.push(lines[j++])
      const text = plainText(buf.join(' '))
      description = ''
      if (buf.length && j < lines.length + 1 && (lines[j] ?? '').trim() === '' && !/\]\(/.test(buf.join(' ')) && text.length <= 300) {
        description = text
        idx = j - 1
        continue
      }
    }
    para.push(line)
  }
  flush()
  if (stack.length) warn(`${page}: ${stack.length} unclosed ::: container(s)`)
  if (fence) warn(`${page}: unclosed code fence`)
  return { title, description, body: out.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n') }
}

// ---------------------------------------------------------------- home pages

function convertHome(data, body, page) {
  const { hero = {}, features = [] } = data
  const md = convertMarkdown(body, page)
  const parts = []
  const actions = hero.actions ?? []
  if (hero.text) parts.push(`## ${convertProse(hero.text, page)}`, '')
  if (actions.length) {
    parts.push(`<Columns cols={${Math.min(actions.length, 3)}}>`)
    for (const a of actions) {
      const icon = a.theme === 'brand' ? 'rocket' : /api/i.test(a.link) ? 'code' : 'book-open'
      parts.push(`  <Card title="${a.text}" icon="${icon}" href="${rewriteHref(a.link, page)}" horizontal />`)
    }
    parts.push('</Columns>', '')
  }
  if (features.length) {
    parts.push('<Columns cols={3}>')
    for (const f of features) {
      const href = f.link ? ` href="${rewriteHref(f.link, page)}"` : ''
      const icon = f.icon ? ` icon="${f.icon}"` : ''
      parts.push(`  <Card title="${f.title}"${icon}${href}>`, `    ${convertProse(plainText(f.details ?? ''), page)}`, '  </Card>')
    }
    parts.push('</Columns>', '')
  }
  return {
    fm: frontMatter({
      title: hero.name ?? 'botmesh',
      sidebarTitle: page.startsWith('es/') ? 'Inicio' : 'Home',
      description: hero.tagline,
      mode: 'wide',
    }),
    body: parts.join('\n') + '\n' + md.body,
  }
}

// ---------------------------------------------------------------- API reference

function runTypeDoc() {
  const require = createRequire(join(tooling, 'package.json'))
  const bin = join(dirname(require.resolve('typedoc/package.json')), 'bin', 'typedoc')
  rmSync(apiCache, { recursive: true, force: true })
  const res = spawnSync(process.execPath, [bin, '--options', join(tooling, 'typedoc.json')], { cwd: tooling, stdio: 'inherit' })
  if (res.status !== 0) throw new Error(`typedoc failed with status ${res.status}`)
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** cache path ('@botmesh/core/spi/classes/X.mdx') -> site page ('api/core/spi/classes/X'). */
const apiPageOf = (cachePath) => {
  const p = cachePath.replace(/\\/g, '/').replace(/\.mdx?$/, '')
  if (p === 'index') return 'api/index'
  return p.replace(/^@botmesh\/core/, 'api/core')
}

const KIND_LABEL = { 'classes': 'Class', 'interfaces': 'Interface', 'functions': 'Function', 'type-aliases': 'Type alias', 'variables': 'Variable', 'enumerations': 'Enumeration' }

function buildApi() {
  runTypeDoc()
  const outDir = join(site, 'api')
  rmSync(outDir, { recursive: true, force: true })
  const files = walk(apiCache).filter((f) => f.endsWith('.mdx'))
  for (const f of files) apiPages.add(apiPageOf(relative(apiCache, f)))
  for (const f of files) {
    const rel = relative(apiCache, f).replace(/\\/g, '/')
    const page = apiPageOf(rel)
    if (page === 'api/index') continue // single-package site: api/core is the landing page
    let src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const h1 = /^# (.+)\n/m.exec(src)
    const deprecated = h1 ? h1[1].includes('~~') : false
    const title = h1
      ? h1[1].replace(/~~/g, '').replace(/^(Class|Interface|Function|Type Alias|Variable|Enumeration): /, '').replace(/\\/g, '')
      : page.split('/').pop()
    if (h1) src = src.replace(h1[0], '')
    // typedoc-plugin-markdown links members as `#name` (lowercased reflection
    // name) while Mintlify would slug `### start()?` as `#start-`: pin the id.
    const seenIds = new Set()
    src = src.replace(/^(###) (.+)$/gm, (line, hashes, text) => {
      const id = text.replace(/\\/g, '').replace(/~~/g, '').replace(/`/g, '').replace(/(\(\))?\??$/, '').toLowerCase()
      if (!/^[\w-]+$/.test(id) || seenIds.has(id)) return line
      seenIds.add(id)
      return `${hashes} ${text} {#${id}}`
    })
    // Relative `.mdx` links -> absolute Mintlify paths.
    src = src.replace(/\]\(([^)\s]+?\.mdx)(#[^)]*)?\)/g, (_, target, hash = '') => {
      const resolved = posix.normalize(posix.join(posix.dirname(rel), target))
      return `](/${apiPageOf(resolved).replace(/\/index$/, '')}${hash})`
    })
    const kind = KIND_LABEL[page.split('/').at(-2)]
    const module = page.startsWith('api/core/spi') ? '@botmesh/core/spi' : page.startsWith('api/core/testing') ? '@botmesh/core/testing' : '@botmesh/core'
    const isIndex = page.endsWith('/index')
    const desc = kind ? `${kind} exported by ${module}.` : `Reference of ${module}, generated by TypeDoc.`
    const fm = frontMatter({ title: isIndex ? module : title, sidebarTitle: isIndex ? 'Overview' : undefined, description: desc, tag: deprecated ? 'Deprecated' : undefined })
    const target = join(site, `${page}.mdx`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, fm + src.replace(/^\n+/, ''))
  }
  // Navigation: module -> category -> pages, from typedoc-plugin-markdown's navigation.json.
  const nav = JSON.parse(readFileSync(join(apiCache, 'navigation.json'), 'utf8'))
  const groups = nav.map((mod) => ({
    group: mod.title,
    pages: [
      apiPageOf(mod.path),
      ...(mod.children ?? []).map((cat) =>
        cat.path && !cat.children
          ? apiPageOf(cat.path)
          : { group: cat.title, pages: (cat.children ?? []).filter((c) => c.path).map((c) => apiPageOf(c.path)) },
      ),
    ],
  }))
  mkdirSync(join(tooling, '.cache'), { recursive: true })
  writeFileSync(join(tooling, '.cache', 'api-nav.json'), JSON.stringify(groups, null, 2))
  return groups
}

function apiGroupsFromSite() {
  const cached = join(tooling, '.cache', 'api-nav.json')
  if (!existsSync(cached)) throw new Error('--skip-api needs a previous full run (mintlify/.cache/api-nav.json)')
  for (const f of walk(join(site, 'api'))) apiPages.add(relative(site, f).replace(/\\/g, '/').replace(/\.mdx$/, ''))
  return JSON.parse(readFileSync(cached, 'utf8'))
}

// ---------------------------------------------------------------- docs.json

function navGroups(sidebar, prefixHome) {
  return sidebar.map((group, i) => ({
    group: group.text,
    pages: [...(i === 0 && prefixHome ? [prefixHome] : []), ...group.items.map((item) => outPage(item.link.slice(1)))],
  }))
}

function docsJson(apiGroups) {
  const en = sidebars.en
  const es = sidebars.es
  const footer = (header, license) => ({
    socials: { github: GITHUB },
    links: [
      {
        header,
        items: [
          { label: 'GitHub', href: GITHUB },
          { label: 'npm', href: NPM },
          { label: license, href: `${GITHUB}/blob/main/LICENSE` },
          { label: 'Changelog', href: `${GITHUB}/blob/main/CHANGELOG.md` },
        ],
      },
    ],
  })
  return {
    $schema: 'https://mintlify.com/docs.json',
    theme: 'mint',
    name: 'botmesh',
    description: 'A transport-agnostic TypeScript framework for messaging bots: WhatsApp (Baileys or the Cloud API), Telegram, Discord and more behind one IProvider.',
    colors: { primary: '#3451B2', light: '#A8B1FF', dark: '#3451B2' },
    logo: { light: '/logo/light.svg', dark: '/logo/dark.svg' },
    favicon: '/favicon.svg',
    icons: { library: 'lucide' },
    navbar: {
      links: [{ label: 'npm', href: NPM }],
      primary: { type: 'github', href: GITHUB },
    },
    footer: footer('Project', 'MIT License'),
    // Page menu, free on every plan ('assistant' needs Pro, so it is left out):
    // copy / view as Markdown, open in an AI chat, and 'mcp' copies the URL of
    // the docs MCP server Mintlify hosts ('cursor' / 'vscode' install it).
    contextual: { options: ['copy', 'view', 'chatgpt', 'claude', 'perplexity', 'mcp', 'cursor', 'vscode'] },
    search: { prompt: 'Search the botmesh docs…' },
    seo: { indexing: 'navigable' },
    // Old Spanish slugs (VitePress URLs) -> mirrored paths.
    redirects: [...esTarget].filter(([from, to]) => from !== to).map(([from, to]) => ({ source: `/${from}`, destination: `/${to}` })),
    navigation: {
      languages: [
        {
          language: 'en',
          default: true,
          tabs: [
            { tab: 'Guide', icon: 'book-open', groups: navGroups(en['/guide/'], 'index') },
            { tab: 'Examples', icon: 'chef-hat', groups: navGroups(en['/examples/']) },
            { tab: 'API reference', icon: 'code', groups: apiGroups },
          ],
        },
        {
          language: 'es',
          footer: footer('Proyecto', 'Licencia MIT'),
          tabs: [
            { tab: 'Guía', icon: 'book-open', groups: navGroups(es['/es/guide/'], 'es/index') },
            { tab: 'Ejemplos', icon: 'chef-hat', groups: navGroups(es['/es/ejemplos/']) },
            // A page path may belong to one language only: the Spanish tab
            // points at the (English) reference instead of duplicating it.
            { tab: 'Referencia de la API', icon: 'code', href: '/api/core' },
          ],
        },
      ],
    },
  }
}

// ---------------------------------------------------------------- llms.txt

/**
 * Rewrites the GitHub Pages links of the curated docs/public/llms.txt to the
 * Mintlify site: Spanish slugs move to their mirrored path, TypeDoc HTML to
 * the generated API pages, unpublished repo files to GitHub, and a bare
 * section folder without an index page (`es/guide/`) to its language home.
 */
function rewriteLlms(text, base) {
  const root = base.endsWith('/') ? base : `${base}/`
  return text.replace(/https:\/\/andresayac\.github\.io\/botmesh\/([^\s)>\]]*)/g, (_, rawPath) => {
    // A sentence may end right after a link: keep the punctuation outside it.
    const [, path, trail] = /^(.*?)([.,;:]*)$/.exec(rawPath)
    let href = path === '' ? '/' : rewriteHref(`/${path}`, 'index')
    if (/\/$/.test(path) && !href.startsWith('/')) href = path.startsWith('es/') ? '/es' : '/'
    if (!href.startsWith('/')) return href + trail
    return root + href.slice(1) + trail
  })
}

// ---------------------------------------------------------------- main

function main() {
  mkdirSync(site, { recursive: true })
  // Generated content only: keep site/api when --skip-api.
  for (const entry of readdirSync(site)) {
    if (skipApi && entry === 'api') continue
    rmSync(join(site, entry), { recursive: true, force: true })
  }
  const apiGroups = skipApi ? apiGroupsFromSite() : buildApi()

  const sources = new Map(pages.map((page) => [page, splitFrontMatter(readFileSync(join(docs, `${page}.md`), 'utf8'))]))
  for (const [page, { body }] of sources) collectAnchors(page, body)

  for (const page of pages) {
    const { data, body } = sources.get(page)
    let fm
    let mdx
    if (data.layout === 'home') {
      ;({ fm, body: mdx } = convertHome(data, body, page))
    } else {
      const res = convertMarkdown(body, page)
      if (!res.title) warn(`${page}: no H1 title`)
      fm = frontMatter({
        title: data.title ?? res.title ?? page.split('/').pop(),
        sidebarTitle: sidebarLabel.get(page) !== res.title ? sidebarLabel.get(page) : undefined,
        description: data.description ?? res.description,
      })
      mdx = res.body
    }
    const target = join(site, `${outPage(page)}.mdx`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, fm + mdx.replace(/\s*$/, '\n'))
  }

  // Pages that exist in docs/ but in no sidebar are still built (reachable by link).
  const inNav = new Set(['index', 'es/index', ...sidebarLabel.keys()])
  for (const page of pages) if (!inNav.has(page)) warn(`${page}: not in any sidebar (published, not in the navigation)`)

  cpSync(join(tooling, 'assets'), site, { recursive: true })
  if (llmsBase) {
    const llms = readFileSync(join(docs, 'public', 'llms.txt'), 'utf8')
    writeFileSync(join(site, 'llms.txt'), rewriteLlms(llms, llmsBase))
  }
  writeFileSync(join(site, 'docs.json'), JSON.stringify(docsJson(apiGroups), null, 2) + '\n')
  writeFileSync(
    join(site, '.mintignore'),
    '# Generated by mintlify/scripts/convert.mjs\nnode_modules/\n',
  )

  const n = pages.length
  console.log(`[convert] ${n} guide pages, ${walk(join(site, 'api')).length} API pages -> ${relative(repo, site)}`)
  if (warnings.length) {
    console.log(`[convert] ${warnings.length} warning(s):`)
    for (const w of warnings) console.log(`  - ${w}`)
  }
}

main()
