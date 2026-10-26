/**
 * Text splitting for transports with a per-message length limit (UTF-16 code units and/or
 * UTF-8 bytes). Prefers the most natural boundary: paragraph, line, sentence, word, then a
 * hard cut on a grapheme boundary (never inside a surrogate pair, a ZWJ emoji sequence or
 * a flag). Markup of the chat's `TextFormat` is kept whole when possible: a cut never
 * lands inside a link, a URL or an HTML tag/entity, and a span that is itself longer than
 * the limit (a fenced code block, inline code, a bold run, an HTML element) is closed at
 * the end of one part and reopened at the start of the next.
 */

import type { TextFormat } from '../core/provider.js'

/** Limits and markup of {@link splitMessage} / `findSplitPoint`. */
export interface SplitTextOptions {
  /** Max UTF-16 code units per part (`capabilities.maxTextLength`). */
  maxLength?: number
  /** Max UTF-8 bytes per part (`capabilities.maxTextBytes`, e.g. Instagram). */
  maxBytes?: number
  /**
   * Markup to keep intact (`ctx.textFormat`). Unset = Markdown-like (`*`, `_`, `~`,
   * backticks, links); `'plain'` = no markup.
   */
  format?: TextFormat
}

const SENTENCE_END = /[.!?…。！？]["'”’)\]]*\s/g

/** A run of markup a cut should not land inside. */
interface Span {
  start: number
  end: number
  /** Text that reopens the span in the next part (`undefined` = cannot be reopened). */
  open?: string
  /** Text that closes the span at the end of a part. */
  close?: string
  /** The span of the whole text this one was shifted from (`splitMessage` rounds). */
  source?: Span
}

const STRENGTH_PARAGRAPH = 4
const STRENGTH_LINE = 3
const STRENGTH_SENTENCE = 2
const STRENGTH_WORD = 1

let segmenter: Intl.Segmenter | undefined
function graphemeSegmenter(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return segmenter
}

/** Never cut between a high and a low surrogate. */
function safeCut(text: string, at: number): number {
  if (at <= 0 || at >= text.length) return at
  const code = text.charCodeAt(at - 1)
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at
}

/** Largest grapheme boundary in `(min, at]` of `text`, else a surrogate-safe cut at `at`. */
function graphemeCut(text: string, at: number, min = 0): number {
  if (at >= text.length) return text.length
  let best = -1
  // A boundary depends on what follows, so look a little past `at`.
  for (const g of graphemeSegmenter().segment(text.slice(0, Math.min(text.length, at + 32)))) {
    if (g.index > at) break
    if (g.index > min) best = g.index
  }
  return best > 0 ? best : Math.max(min + 1, safeCut(text, at))
}

/** UTF-8 length of one UTF-16 unit (each half of a surrogate pair counts 2). */
function unitBytes(code: number): number {
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code >= 0xd800 && code <= 0xdfff) return 2
  return 3
}

function utf8Length(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) total += unitBytes(text.charCodeAt(i))
  return total
}

/** Longest prefix (in code units) of `text` that fits both limits. */
function fitLength(text: string, maxLength: number, maxBytes: number): number {
  let n = Math.min(text.length, maxLength)
  if (maxBytes === Infinity) return safeCut(text, n)
  let total = 0
  for (let i = 0; i < n; i++) {
    total += unitBytes(text.charCodeAt(i))
    if (total > maxBytes) { n = i; break }
  }
  return safeCut(text, n)
}

/** True when `text` already fits both limits. */
function fits(text: string, maxLength: number, maxBytes: number): boolean {
  return text.length <= maxLength && (maxBytes === Infinity || utf8Length(text) <= maxBytes)
}

/* ---------------------------------------------------------------------------
 * Markup spans
 *
 * Every scanner is linear in the text: the patterns whose regex form would rescan to the
 * end of a line (or of the text) for each opener that never closes (emphasis, link
 * brackets, HTML tags and pairs) look their closer up in sorted position lists instead.
 * The spans of a text are found once per `splitMessage` call, not once per part.
 * ------------------------------------------------------------------------- */

const FENCE = /```([^\n`]*)\n[\s\S]*?```/g
const INLINE_CODE = /`[^`\n]+`/g
const URL_RE = /\bhttps?:\/\/[^\s<>()]+/g
const HTML_ENTITY = /&#?[a-z0-9]+;/gi
/** Elements kept whole (and reopened across parts) in the `'html'` format. */
const HTML_PAIRS = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'span', 'tg-spoiler', 'blockquote', 'q']

/** Paired single-line emphasis markers per format (longest first). */
const MD_EMPHASIS = ['**', '__', '~~', '||', '*', '_', '~']
const WA_EMPHASIS = ['*', '_', '~']

const WS = /\s/

/** `\s` of a regular expression. */
function isWs(ch: string | undefined): boolean {
  if (ch === undefined) return false
  const code = ch.charCodeAt(0)
  if (code < 0x80) return code === 32 || (code >= 9 && code <= 13)
  return WS.test(ch)
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch)
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z]/.test(ch)
}

/** Smallest value of the ascending `sorted` that is `>= from`, else -1. */
function nextIn(sorted: readonly number[], from: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((sorted[mid] as number) < from) lo = mid + 1
    else hi = mid
  }
  return lo < sorted.length ? sorted[lo] as number : -1
}

/** The nearer of two `nextIn` results (-1 = none). */
function nearer(a: number, b: number): number {
  return a === -1 ? b : b === -1 ? a : Math.min(a, b)
}

/** Positions of the characters the scanners look ahead for, found in one pass. */
interface CharIndex { nl: number[]; gt: number[]; rbracket: number[]; rparen: number[]; ws: number[] }

function indexChars(text: string): CharIndex {
  const idx: CharIndex = { nl: [], gt: [], rbracket: [], rparen: [], ws: [] }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '>') idx.gt.push(i)
    else if (ch === ']') idx.rbracket.push(i)
    else if (ch === ')') idx.rparen.push(i)
    else if (isWs(ch)) {
      idx.ws.push(i)
      if (ch === '\n') idx.nl.push(i)
    }
  }
  return idx
}

/**
 * The spans found so far, which never overlap (the tags nested in an HTML pair are added
 * apart). `covered` marks their positions, so an overlap check costs the length of the
 * candidate, and the candidates of one scanner never overlap each other.
 */
class SpanSet {
  readonly spans: Span[] = []
  private readonly covered: Uint8Array

  constructor(length: number) { this.covered = new Uint8Array(length) }

  add(span: Span): void {
    for (let p = span.start; p < span.end; p++) if (this.covered[p] === 1) return
    this.covered.fill(1, span.start, span.end)
    this.spans.push(span)
  }
}

/** Matches of a global `re` whose matching never rescans far (no lazy run to a closer). */
function collect(text: string, re: RegExp, set: SpanSet, make: (m: RegExpExecArray) => Span): void {
  re.lastIndex = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    set.add(make(m))
    if (m[0].length === 0) re.lastIndex++
  }
}

/**
 * Emphasis runs of `marker`, as `marker[^\s c](?:[^\n]*?[^\s c])?marker` would match them
 * (`c` = the marker's character): an opener before a non-space, the nearest closer after
 * a non-space, on the same line.
 */
function scanEmphasis(text: string, marker: string, idx: CharIndex, set: SpanSet): void {
  const len = marker.length
  const c = marker[0]
  const blocked = (ch: string | undefined): boolean => ch === undefined || ch === c || isWs(ch)
  const closers: number[] = []
  for (let j = text.indexOf(marker, 1); j !== -1; j = text.indexOf(marker, j + 1)) {
    if (!blocked(text[j - 1])) closers.push(j)
  }
  if (closers.length === 0) return
  for (let i = 0; ;) {
    const s = text.indexOf(marker, i)
    if (s === -1) return
    if (!blocked(text[s + len])) {
      // The optional middle group is greedy: a closer past a one-character run wins.
      let j = nextIn(closers, s + len + 2)
      const nl = nextIn(idx.nl, s + len)
      if (j === -1 || (nl !== -1 && nl < j)) j = text.startsWith(marker, s + len + 1) ? s + len + 1 : -1
      if (j !== -1) {
        set.add({ start: s, end: j + len, open: marker, close: marker })
        i = j + len
        continue
      }
    }
    i = s + 1
  }
}

/** Markdown links and images, as `!?\[[^\]\n]*\]\([^)\s]*\)` would match them. */
function scanLinks(text: string, idx: CharIndex, set: SpanSet): void {
  for (let i = 0; ;) {
    const b = text.indexOf('[', i)
    if (b === -1) return
    const k = nearer(nextIn(idx.rbracket, b + 1), nextIn(idx.nl, b + 1))
    if (k !== -1 && text[k] === ']' && text[k + 1] === '(') {
      const e = nearer(nextIn(idx.rparen, k + 2), nextIn(idx.ws, k + 2))
      if (e !== -1 && text[e] === ')') {
        set.add({ start: b - 1 >= i && text[b - 1] === '!' ? b - 1 : b, end: e + 1 })
        i = e + 1
        continue
      }
    }
    i = b + 1
  }
}

/** HTML tags in `[from, to)`, as `<\/?[a-z][^>\n]*>` (case-insensitive) would match them. */
function scanTags(text: string, idx: CharIndex, from: number, to: number, add: (span: Span) => void): void {
  for (let i = from; ;) {
    const lt = text.indexOf('<', i)
    if (lt === -1 || lt >= to) return
    const name = text[lt + 1] === '/' ? lt + 2 : lt + 1
    if (isAsciiLetter(text[name])) {
      const g = nearer(nextIn(idx.gt, name + 1), nextIn(idx.nl, name + 1))
      if (g !== -1 && g < to && text[g] === '>') {
        add({ start: lt, end: g + 1 })
        i = g + 1
        continue
      }
    }
    i = lt + 1
  }
}

/** HTML entities in `[from, to)`. */
function scanEntities(text: string, from: number, to: number, add: (span: Span) => void): void {
  const inner = from === 0 && to === text.length ? text : text.slice(from, to)
  HTML_ENTITY.lastIndex = 0
  for (let m = HTML_ENTITY.exec(inner); m; m = HTML_ENTITY.exec(inner)) add({ start: from + m.index, end: from + m.index + m[0].length })
}

/** The listed element name starting at `at` (then a non-word character), else `undefined`. */
function pairNameAt(text: string, at: number): string | undefined {
  for (const tag of HTML_PAIRS) {
    if (text.slice(at, at + tag.length).toLowerCase() === tag && !isWordChar(text[at + tag.length])) return tag
  }
  return undefined
}

/**
 * HTML elements, as `<(b|strong|…)\b[^>]*>[\s\S]*?<\/\1>` (case-insensitive) would match
 * them: the nearest closing tag of the same name.
 */
function scanPairs(text: string, idx: CharIndex, set: SpanSet): void {
  const closers = new Map<string, number[]>()
  const closersOf = (tag: string): number[] => {
    let list = closers.get(tag)
    if (!list) {
      list = []
      const re = new RegExp(`</${tag}>`, 'gi')
      for (let m = re.exec(text); m; m = re.exec(text)) list.push(m.index)
      closers.set(tag, list)
    }
    return list
  }
  for (let i = 0; ;) {
    const lt = text.indexOf('<', i)
    if (lt === -1) return
    const tag = pairNameAt(text, lt + 1)
    const g = tag === undefined ? -1 : nextIn(idx.gt, lt + 1 + tag.length)
    const close = tag === undefined || g === -1 ? -1 : nextIn(closersOf(tag), g + 1)
    if (tag !== undefined && close !== -1) {
      const end = close + tag.length + 3
      set.add({ start: lt, end, open: text.slice(lt, g + 1), close: `</${text.slice(lt + 1, lt + 1 + tag.length)}>` })
      i = end
      continue
    }
    i = lt + 1
  }
}

/** Markup spans of `text` for `format` (non-overlapping, except tags nested in an HTML pair). */
function findSpans(text: string, format: TextFormat | undefined): Span[] {
  if (format === 'plain') return []
  const set = new SpanSet(text.length)
  const idx = indexChars(text)
  const whole = (m: RegExpExecArray): Span => ({ start: m.index, end: m.index + m[0].length })
  const add = (span: Span): void => set.add(span)
  if (format === 'html') {
    scanPairs(text, idx, set)
    scanTags(text, idx, 0, text.length, add)
    scanEntities(text, 0, text.length, add)
    collect(text, URL_RE, set, whole)
    // Tags and entities inside a pair stay whole too.
    const nested: Span[] = []
    const push = (span: Span): void => { nested.push(span) }
    for (const pair of set.spans) {
      if (pair.open === undefined) continue
      const from = pair.start + pair.open.length
      const to = pair.end - (pair.close?.length ?? 0)
      scanTags(text, idx, from, to, push)
      scanEntities(text, from, to, push)
    }
    return [...set.spans, ...nested]
  }
  collect(text, FENCE, set, (m) => ({
    start: m.index, end: m.index + m[0].length, open: '```' + (m[1] ?? '') + '\n', close: '\n```',
  }))
  collect(text, INLINE_CODE, set, (m) => ({ ...whole(m), open: '`', close: '`' }))
  if (format !== 'whatsapp') scanLinks(text, idx, set)
  collect(text, URL_RE, set, whole)
  for (const marker of format === 'whatsapp' ? WA_EMPHASIS : MD_EMPHASIS) scanEmphasis(text, marker, idx, set)
  return set.spans
}

/** `mask[p] === 1` when a cut at `p` (≤ `upTo`) lands strictly inside one of `spans`. */
function blockedMask(spans: Span[], upTo: number): Uint8Array {
  const mask = new Uint8Array(upTo + 1)
  for (const s of spans) {
    for (let p = s.start + 1; p < s.end && p <= upTo; p++) mask[p] = 1
  }
  return mask
}

/* ---------------------------------------------------------------------------
 * Boundaries
 * ------------------------------------------------------------------------- */

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === ' ' || ch === '　'
}

/** Sentence-end cut positions of `text` within `[0, upTo]` (after or before the space). */
function sentenceEnds(text: string, upTo: number): Set<number> {
  const out = new Set<number>()
  const window = text.slice(0, upTo + 1)
  SENTENCE_END.lastIndex = 0
  for (let m = SENTENCE_END.exec(window); m; m = SENTENCE_END.exec(window)) {
    const end = m.index + m[0].length
    out.add(end)
    out.add(end - 1)
  }
  return out
}

/** Boundary strength of a cut at `p` (0 = not a boundary). */
function strengthAt(text: string, p: number, sentences: Set<number>): number {
  const before = text[p - 1]
  const after = text[p]
  if ((before === '\n' && text[p - 2] === '\n') || (after === '\n' && text[p + 1] === '\n')) return STRENGTH_PARAGRAPH
  if (before === '\n' || after === '\n') return STRENGTH_LINE
  if (sentences.has(p)) return STRENGTH_SENTENCE
  if (isSpace(before) || isSpace(after)) return STRENGTH_WORD
  return 0
}

/**
 * Best cut in `(min, limit]`: the strongest boundary at or past `floor` (the largest of
 * its strength), else the strongest anywhere. `mask` rules cuts out. -1 when none.
 */
function bestBoundary(text: string, limit: number, min: number, floor: number, mask?: Uint8Array): number {
  const sentences = sentenceEnds(text, limit)
  const pastFloor = [-1, -1, -1, -1, -1]
  const anywhere = [-1, -1, -1, -1, -1]
  for (let p = limit; p > min; p--) {
    if (mask?.[p] === 1) continue
    const s = strengthAt(text, p, sentences)
    if (s === 0) continue
    if (p >= floor && pastFloor[s] === -1) pastFloor[s] = p
    if (anywhere[s] === -1) anywhere[s] = p
  }
  for (const found of [pastFloor, anywhere]) {
    for (let s = STRENGTH_PARAGRAPH; s >= STRENGTH_WORD; s--) {
      const p = found[s] ?? -1
      if (p > min) return p
    }
  }
  return -1
}

interface Limits { maxLength: number; maxBytes: number; format: TextFormat | undefined }

function normalize(limit: number | SplitTextOptions): Limits {
  const opts = typeof limit === 'number' ? { maxLength: limit } : limit
  const maxLength = opts.maxLength ?? Infinity
  const maxBytes = opts.maxBytes ?? Infinity
  if (!(maxLength > 0) || !(maxBytes > 0) || (maxLength === Infinity && maxBytes === Infinity)) {
    throw new RangeError(`splitMessage: max must be > 0, got ${typeof limit === 'number' ? limit : JSON.stringify(limit)}`)
  }
  return {
    maxLength: maxLength === Infinity ? Infinity : Math.floor(maxLength),
    maxBytes: maxBytes === Infinity ? Infinity : Math.floor(maxBytes),
    format: opts.format,
  }
}

interface Cut {
  /** Where the head ends in `text`. */
  at: number
  /** Appended to the head (closes a span cut in two). */
  close: string
  /** Prepended to the rest (reopens it). */
  open: string
  /** The span that was closed and reopened. */
  host?: Span
}

/** The cut of `text`, whose markup `spans` are given (only those starting before the limit matter). */
function cutOf(text: string, { maxLength, maxBytes }: Limits, spans: Span[]): Cut {
  const limit = Math.max(1, fitLength(text, maxLength, maxBytes))
  const floor = Math.floor(limit * 0.3)
  const at = bestBoundary(text, limit, 0, floor, blockedMask(spans, limit))
  if (at > 0) return { at, close: '', open: '' }

  // Every boundary falls inside markup: close and reopen the outermost reopenable span.
  const host = spans
    .filter((s) => s.open !== undefined && s.close !== undefined && s.start < limit && limit < s.end)
    .sort((a, b) => a.start - b.start)[0]
  if (host?.open !== undefined && host.close !== undefined) {
    const close = host.close
    const room = Math.min(limit - close.length, fitLength(text, maxLength - close.length, maxBytes - close.length))
    const min = host.start + host.open.length
    if (room > min) {
      const nested = spans.filter((s) => s !== host && s.start >= min)
      let p = bestBoundary(text, room, min, min + Math.floor((room - min) * 0.3), blockedMask(nested, room))
      if (p <= min) p = graphemeCut(text, room, min)
      if (p > min && p <= room) return { at: p, close, open: host.open, host }
    }
  }

  // No markup-safe cut: any boundary, else a grapheme-safe hard cut (outside tags/entities).
  const any = bestBoundary(text, limit, 0, floor)
  if (any > 0) return { at: any, close: '', open: '' }
  let hard = graphemeCut(text, limit)
  for (const s of spans) {
    if (s.open === undefined && s.start > 0 && s.start < hard && hard < s.end) hard = s.start
  }
  return { at: Math.max(1, hard), close: '', open: '' }
}

/**
 * Index where `text` should be cut so the head fits `limit` (a max length in UTF-16 code
 * units, or {@link SplitTextOptions}). Returns `text.length` when it already fits. When a
 * markup span must be cut in two, the index lands inside it ({@link splitMessage} closes
 * and reopens the span).
 */
export function findSplitPoint(text: string, limit: number | SplitTextOptions): number {
  const limits = normalize(limit)
  if (fits(text, limits.maxLength, limits.maxBytes)) return text.length
  return cutOf(text, limits, findSpans(text, limits.format)).at
}

/** First index of the ascending-by-start `spans` whose start is `>= from`. */
function firstSpanFrom(spans: readonly Span[], from: number): number {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((spans[mid] as Span).start < from) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Split `text` into parts that fit `limit`: a max length in UTF-16 code units, or
 * {@link SplitTextOptions} with `maxLength`, `maxBytes` (UTF-8) and the markup `format`.
 * Cuts land on natural boundaries (paragraph, line, sentence, word), never inside a
 * grapheme or a markup entity; a fenced block, inline code, emphasis run or HTML element
 * longer than the limit is closed and reopened across parts. Whitespace at a cut is
 * dropped (the indentation of the next line is kept); whitespace-only parts are dropped.
 * Run time is linear in the length of `text` (its markup is scanned once).
 *
 * @example
 * ```ts
 * for (const part of splitMessage(longText, { maxLength: 4096, format: ctx.textFormat })) {
 *   await ctx.reply(part)
 * }
 * ```
 */
export function splitMessage(text: string, limit: number | SplitTextOptions): string[] {
  const limits = normalize(limit)
  const { maxLength, maxBytes } = limits
  if (fits(text, maxLength, maxBytes)) {
    const only = text.trim()
    return only ? [only] : []
  }
  const n = text.length
  const all = findSpans(text, limits.format).sort((a, b) => a.start - b.start)
  // UTF-8 bytes of text[0, i), so the size of what is left is known without rescanning it.
  let bytesBefore: Float64Array | undefined
  if (maxBytes !== Infinity) {
    bytesBefore = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) bytesBefore[i + 1] = (bytesBefore[i] as number) + unitBytes(text.charCodeAt(i))
  }
  // A cut never looks further than the limit plus a few units (boundaries, graphemes).
  const reach = Math.min(maxLength, maxBytes) + 64

  // What is left to split is `prefix` (a reopened span) followed by text[offset, n).
  let prefix = ''
  let offset = 0
  /** The span `prefix` reopens (in `text` positions). */
  let host: Span | undefined
  // A cut that lands inside a span without reopening it leaves the rest of that span
  // unscanned (its inner markup overlapped it): `overlay` holds the spans found by scanning
  // that rest on its own, up to `overlayEnd`; past it, the spans of the whole text apply.
  let overlay: Span[] = []
  let overlayEnd = 0
  const out: string[] = []
  for (;;) {
    const restLength = prefix.length + n - offset
    const restBytes = bytesBefore ? utf8Length(prefix) + (bytesBefore[n] as number) - (bytesBefore[offset] as number) : 0
    if (restLength <= maxLength && restBytes <= maxBytes) break
    const view = prefix + text.slice(offset, offset + reach)
    const shift = prefix.length - offset
    const spans: Span[] = []
    if (host && prefix.startsWith(host.open ?? '\0') && host.end > offset) {
      spans.push({ start: 0, end: host.end + shift, open: host.open, close: host.close, source: host })
    }
    for (const list of [overlay, all]) {
      const first = firstSpanFrom(list, list === all ? Math.max(offset, overlayEnd) : offset)
      for (let k = first; k < list.length && (list[k] as Span).start < offset + reach; k++) {
        const s = list[k] as Span
        spans.push({ start: s.start + shift, end: s.end + shift, open: s.open, close: s.close, source: s })
      }
    }
    const cut = cutOf(view, limits, spans)
    const at = cut.at
    const head = view.slice(0, at).trimEnd()
    if (head.trim() && head !== cut.open.trimEnd()) out.push(head + cut.close)

    // The rest after the cut: `tail` (what is left of the prefix) + text[from, n).
    let tail = at < prefix.length ? prefix.slice(at) : ''
    let from = at < prefix.length ? offset : offset + at - prefix.length
    const charAt = (i: number): string | undefined => (i < tail.length ? tail[i] : text[from + i - tail.length])
    const drop = (count: number): void => {
      if (count <= tail.length) { tail = tail.slice(count); return }
      from += count - tail.length
      tail = ''
    }
    // Drop the whitespace at the cut, but keep the indentation of a line the cut starts.
    let lastNewline = -1
    for (let i = 0; i < tail.length + n - from && isWs(charAt(i)); i++) if (charAt(i) === '\n') lastNewline = i
    if (lastNewline >= 0) drop(lastNewline + 1)
    else if (view[at - 1] !== '\n') {
      let i = 0
      while (i < tail.length + n - from && isSpace(charAt(i))) i++
      drop(i)
    }
    if (cut.open) tail = cut.open + tail
    host = cut.open ? cut.host?.source : undefined
    // Defensive: every round must consume input.
    if (tail.length + n - from >= restLength) {
      const skip = Math.max(1, at)
      tail = skip < prefix.length ? prefix.slice(skip) : ''
      from = skip < prefix.length ? offset : offset + skip - prefix.length
      host = undefined
    }
    // A span cut in two without being reopened: scan the rest of it on its own.
    let straddled = -1
    for (const s of spans) {
      if (s !== cut.host && s.source && s.start < at && at < s.end) straddled = Math.max(straddled, s.source.end)
    }
    if (straddled > from) {
      const inner = findSpans(text.slice(from, straddled), limits.format)
        .map((s) => ({ ...s, start: s.start + from, end: s.end + from }))
        .sort((a, b) => a.start - b.start)
      overlay = [...inner, ...overlay.filter((s) => s.start >= straddled)]
      overlayEnd = Math.max(overlayEnd, straddled)
    }
    prefix = tail
    offset = from
  }
  const rest = prefix + text.slice(offset)
  const last = out.length === 0 ? rest.trim() : rest.trimEnd()
  if (last.trim()) out.push(last)
  return out
}

/**
 * End index of the last sentence boundary in `text` at or after `minChars`
 * (paragraph/line breaks count), or -1. Used by the `'chunk'` strategy.
 */
export function lastBoundaryAfter(text: string, minChars: number): number {
  let best = -1
  SENTENCE_END.lastIndex = 0
  for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
    const end = m.index + m[0].length
    if (end >= minChars) best = end
  }
  const line = text.lastIndexOf('\n')
  if (line >= 0 && line + 1 >= minChars && line + 1 > best) best = line + 1
  return best
}
