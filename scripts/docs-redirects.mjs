// Redirect stubs for the old GitHub Pages site (`pnpm docs:deploy --redirects`).
//
// The docs moved to Mintlify. Every HTML page of the VitePress build (guides in
// both languages, examples, the TypeDoc /api/ pages, 404.html) becomes a tiny
// static page at the same path that sends the reader to the same page on the
// Mintlify site: a JS `location.replace` that keeps (and translates) the hash,
// a `<meta http-equiv="refresh">` without JS, `rel="canonical"` for search
// engines and a visible link. Where each page goes comes from
// mintlify/scripts/site-map.mjs, the rules the converter places pages with.
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { legacyTarget } from '../mintlify/scripts/site-map.mjs'

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapes text for an HTML text node or a quoted attribute. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

/** JSON that is safe inside an inline `<script>` (no `</script>`, `<!--` or line separators). */
export function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Absolute Mintlify URL of a site path ('/guide/flows' -> 'https://site/guide/flows'). */
export function absoluteUrl(siteUrl, path) {
  if (/^https?:\/\//.test(path)) return path
  return siteUrl + path.replace(/^\/+/, '')
}

const TEXT = {
  en: { title: 'Redirecting', moved: 'The botmesh docs moved to' },
  es: { title: 'Redirigiendo', moved: 'La documentación de botmesh se mudó a' },
}

/**
 * The stub page. `anchors` maps old (VitePress) anchors to new ones ('' drops
 * the hash: the old anchor was the page title); `lowerAnchors` lowercases the
 * hash (TypeDoc members, whose Mintlify ids are pinned in lowercase); any other
 * hash is kept as is.
 */
export function redirectStub({ url, anchors = {}, lowerAnchors = false, lang = 'en' }) {
  const text = TEXT[lang] ?? TEXT.en
  const href = escapeHtml(url)
  const script =
    `(function(){var u=${scriptJson(url)},a=${scriptJson(anchors)},l=${lowerAnchors ? 'true' : 'false'},h=location.hash.slice(1);` +
    'if(h){var k=h;try{k=decodeURIComponent(h)}catch(e){}var t=l?k.toLowerCase():h;' +
    'if(Object.prototype.hasOwnProperty.call(a,k))t=a[k];if(t)u+="#"+t}location.replace(u)})()'
  return [
    '<!doctype html>',
    `<html lang="${lang === 'es' ? 'es' : 'en'}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${text.title}: ${href}</title>`,
    '<meta name="robots" content="noindex">',
    `<link rel="canonical" href="${href}">`,
    `<script>${script}</script>`,
    `<meta http-equiv="refresh" content="0; url=${href}">`,
    '</head>',
    '<body>',
    `<p>${text.moved} <a href="${href}">${href}</a>.</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** Every `.html` file under `dir`, as a forward-slash path relative to it, sorted. */
export function listHtml(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)).replace(/\\/g, '/'))
    .sort()
}

/**
 * One redirect per HTML file of the old site: `{ file, url, kind, anchors,
 * lowerAnchors, lang }`. `map` is `loadSiteMap(docs)`, `anchorTable` the
 * converter's mintlify/.cache/anchors.json (page -> old anchor -> new anchor)
 * and `hasPage(page)` tells whether a Mintlify page was generated.
 */
export function planRedirects({ files, map, siteUrl, anchorTable = {}, hasPage }) {
  return files.map((file) => {
    const target = legacyTarget(file, map, { hasPage })
    return {
      file,
      kind: target.kind,
      url: absoluteUrl(siteUrl, target.path),
      path: target.path,
      anchors: (target.page && anchorTable[target.page]) || {},
      lowerAnchors: target.kind === 'api',
      lang: file === 'es' || file.startsWith('es/') ? 'es' : 'en',
    }
  })
}
