/**
 * HTML → plain text for HighLevel Email bodies (the `InboundMessage` webhook
 * carries the email's HTML in `body`). Not a renderer: block tags and `<br>`
 * become line breaks, `script`/`style`/`head` content is dropped, entities are
 * decoded and whitespace is collapsed. Every step is linear in the input, so a
 * hostile body (thousands of unclosed tags) cannot stall the webhook.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  euro: '€', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', ouml: 'ö', auml: 'ä', szlig: 'ß',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', deg: '°',
  zwnj: '', zwj: '', shy: '',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,15});/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
}

/** Tags that start or end a line. */
const BLOCK_TAGS = new Set([
  'br', 'p', 'div', 'tr', 'li', 'ul', 'ol', 'table', 'blockquote', 'pre', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer',
])
/** Elements whose whole content is dropped. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'head', 'title', 'noscript', 'template'])
const TAG_NAME = /^\/?([a-z][a-z0-9]*)/i

/** True when a body looks like HTML markup (a tag, comment or doctype). */
export function looksLikeHtml(text: string): boolean {
  return /<(?:[a-z][a-z0-9]*[\s/>]|\/[a-z]|!)/i.test(text)
}

export function htmlToText(html: string): string {
  const parts: string[] = []
  /** Closing tags known to be absent from a position on (searched once per name). */
  const missing = new Set<string>()
  const text = (chunk: string): void => {
    if (chunk) parts.push(decodeEntities(chunk.replace(/\s+/g, ' ')))
  }
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    const gt = lt === -1 ? -1 : html.indexOf('>', lt + 1)
    // No further complete tag: the rest is text.
    if (gt === -1) {
      text(html.slice(i))
      break
    }
    text(html.slice(i, lt))
    i = gt + 1
    const tag = html.slice(lt + 1, gt)
    const name = TAG_NAME.exec(tag)?.[1]?.toLowerCase()
    if (!name) continue
    if (BLOCK_TAGS.has(name)) {
      parts.push('\n')
      continue
    }
    if (!tag.startsWith('/') && RAW_TEXT_TAGS.has(name) && !missing.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'gi')
      close.lastIndex = i
      const hit = close.exec(html)
      if (hit) i = hit.index + hit[0].length
      else missing.add(name)
    }
  }
  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}
