/**
 * HTML -> plain text for inbound emails that ship only an HTML body. Not a
 * renderer: it keeps the readable structure (paragraphs, line breaks, list
 * items, link targets) and drops everything a bot cannot use.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  euro: '€', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', ouml: 'ö', auml: 'ä', szlig: 'ß',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', deg: '°', ordm: 'º', ordf: 'ª',
  zwnj: '', zwj: '', shy: '',
}

/** Decode HTML character references (named subset + all numeric forms). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
}

/** Closing tags that end a block (a line break). */
const BLOCK_END_TAGS = new Set(['p', 'div', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'table', 'ul', 'ol', 'section', 'article', 'header', 'footer', 'pre'])
/** Opening tags that start a block (a line break); `li` renders as a bullet instead. */
const BLOCK_START_TAGS = new Set([...BLOCK_END_TAGS].filter((t) => t !== 'li'))
/** Elements whose whole content is dropped. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'head', 'title', 'noscript', 'template'])

const TAG_NAME = /^(\/?)([a-z]\w*)/i
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

/** Newlines in HTML source are insignificant whitespace. */
const flatten = (text: string): string => text.replace(/\r\n?|\n/g, ' ')

/**
 * Finds closing tags (`</name>`, case-insensitive) left to right. A failed
 * search is remembered per name (a later one, from further on, fails too) and a
 * hit is reused until the scan passes it, so hostile input such as thousands
 * of unclosed `<script>` or `<a>` tags stays linear.
 */
class ClosingTagFinder {
  private readonly missing = new Set<string>()
  private readonly found = new Map<string, { start: number; end: number }>()
  constructor(private readonly html: string) {}

  /** The first `</name\s*>` at or after `from`: where it starts and the index after it. */
  next(name: string, from: number): { start: number; end: number } | undefined {
    if (this.missing.has(name)) return undefined
    const cached = this.found.get(name)
    if (cached && cached.start >= from) return cached
    const re = new RegExp(`</${name}\\s*>`, 'gi')
    re.lastIndex = from
    const m = re.exec(this.html)
    if (!m) {
      this.missing.add(name)
      return undefined
    }
    const hit = { start: m.index, end: m.index + m[0].length }
    this.found.set(name, hit)
    return hit
  }
}

/** Remove every `<...>` from a fragment; a `<` with no later `>` stays as text. Linear. */
function stripTags(text: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const lt = text.indexOf('<', i)
    const gt = lt === -1 ? -1 : text.indexOf('>', lt + 1)
    if (gt === -1) return out + text.slice(i)
    out += text.slice(i, lt)
    i = gt + 1
  }
}

/** A fragment without its comments and dropped elements (`<script>`, `<style>`…). Linear. */
function dropHidden(html: string): string {
  const closers = new ClosingTagFinder(html)
  let out = ''
  let i = 0
  let from = 0
  for (;;) {
    const lt = html.indexOf('<', from)
    if (lt === -1) return out + html.slice(i)
    from = lt + 1
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      if (end === -1) return out + html.slice(i) // no later comment can close either
      out += html.slice(i, lt)
      i = from = end + 3
      continue
    }
    const m = /^<([a-z]\w*)/i.exec(html.slice(lt, lt + 32))
    const name = m?.[1]!.toLowerCase()
    if (!name || !RAW_TEXT_TAGS.has(name)) continue
    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) return out + html.slice(i)
    const close = closers.next(name, gt + 1)
    if (!close) continue
    out += html.slice(i, lt)
    i = from = close.end
  }
}

/** What a tag other than a dropped element or a link renders as. */
function tagText(closing: boolean, name: string, rest: string): string {
  const bare = /^\s*$/.test(rest)
  if (closing) {
    if ((name === 'td' || name === 'th') && bare) return ' '
    return BLOCK_END_TAGS.has(name) && bare ? '\n' : ''
  }
  if (name === 'br') return /^\s*\/?$/.test(rest) ? '\n' : ''
  if (name === 'li') return '\n- '
  if (name === 'hr') return '\n'
  return BLOCK_START_TAGS.has(name) && (bare || /^\s/.test(rest)) ? '\n' : ''
}

/**
 * Convert an HTML email body to readable plain text. A single left-to-right
 * scan (no backtracking regex over the whole body), so its time stays linear
 * in the input size whatever the HTML looks like.
 */
export function htmlToText(html: string): string {
  const closers = new ClosingTagFinder(html)
  let s = ''
  let i = 0
  // Next '-->' (cached like closing tags: -1 once none is left).
  let commentEnd = -2
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) break
    if (html.startsWith('<!--', lt)) {
      if (commentEnd !== -1 && commentEnd < lt + 4) commentEnd = html.indexOf('-->', lt + 4)
      const end = commentEnd
      if (end !== -1) {
        s += flatten(html.slice(i, lt))
        i = end + 3
        continue
      }
    }
    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) break // no '>' left: the rest is text
    if (gt === lt + 1) { // '<>' is text
      s += flatten(html.slice(i, gt + 1))
      i = gt + 1
      continue
    }
    s += flatten(html.slice(i, lt))
    i = gt + 1
    const tag = html.slice(lt + 1, gt)
    const m = TAG_NAME.exec(tag)
    if (!m) continue // `<!doctype …>`, `< 5 >`…: dropped like any other tag
    const closing = m[1] === '/'
    const name = m[2]!.toLowerCase()
    const rest = tag.slice(m[0].length)
    if (!closing && RAW_TEXT_TAGS.has(name)) {
      const close = closers.next(name, gt + 1)
      if (close) i = close.end
      continue
    }
    if (!closing && name === 'a') {
      const href = HREF.exec(rest)
      const close = href ? closers.next('a', gt + 1) : undefined
      if (href && close) {
        const label = stripTags(flatten(dropHidden(html.slice(gt + 1, close.start))))
        const target = decodeEntities((href[1] ?? href[2] ?? href[3] ?? '').trim())
        const labelText = decodeEntities(label).trim()
        const plain = !target || /^(mailto:|#|javascript:)/i.test(target) || target === labelText || !/^https?:/i.test(target)
        s += plain ? label : `${label} (${target})`
        i = close.end
        continue
      }
    }
    s += tagText(closing, name, rest)
  }
  s = decodeEntities(s + flatten(html.slice(i)))
  const lines = s.split('\n').map((line) => line.replace(/[ \t ]+/g, ' ').trim())
  // Paragraph tags produce single breaks; explicit <br><br> runs keep ONE blank line.
  const out: string[] = []
  let blank = 0
  for (const line of lines) {
    if (line === '') { blank++; continue }
    if (out.length && blank >= 3) out.push('')
    out.push(line)
    blank = 0
  }
  return out.join('\n').trim()
}
