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

/** Limits and markup of {@link splitMessage} / {@link findSplitPoint}. */
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
 * ------------------------------------------------------------------------- */

const FENCE = /```([^\n`]*)\n[\s\S]*?```/g
const INLINE_CODE = /`[^`\n]+`/g
const MD_LINK = /!?\[[^\]\n]*\]\([^)\s]*\)/g
const URL_RE = /\bhttps?:\/\/[^\s<>()]+/g
const HTML_PAIR = /<(b|strong|i|em|u|ins|s|strike|del|a|code|pre|span|tg-spoiler|blockquote|q)\b[^>]*>[\s\S]*?<\/\1>/gi
const HTML_TAG = /<\/?[a-z][^>\n]*>/gi
const HTML_ENTITY = /&#?[a-z0-9]+;/gi

/** Paired single-line emphasis markers per format (longest first). */
const MD_EMPHASIS = ['**', '__', '~~', '||', '*', '_', '~']
const WA_EMPHASIS = ['*', '_', '~']
const EMPHASIS_RE = new Map<string, RegExp>()

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Opening marker before a non-space, closing marker after a non-space, on one line. */
function emphasisRe(marker: string): RegExp {
  let re = EMPHASIS_RE.get(marker)
  if (!re) {
    const q = escapeRe(marker)
    const c = escapeRe(marker[0] ?? '')
    re = new RegExp(`${q}[^\\s${c}](?:[^\\n]*?[^\\s${c}])?${q}`, 'g')
    EMPHASIS_RE.set(marker, re)
  }
  return re
}

function overlaps(spans: Span[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start)
}

function collect(text: string, re: RegExp, spans: Span[], make: (m: RegExpExecArray) => Span): void {
  re.lastIndex = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const span = make(m)
    if (!overlaps(spans, span.start, span.end)) spans.push(span)
    if (m[0].length === 0) re.lastIndex++
  }
}

/** Markup spans of `text` for `format` (non-overlapping, except tags nested in an HTML pair). */
function findSpans(text: string, format: TextFormat | undefined): Span[] {
  const spans: Span[] = []
  if (format === 'plain') return spans
  const whole = (m: RegExpExecArray): Span => ({ start: m.index, end: m.index + m[0].length })
  if (format === 'html') {
    collect(text, HTML_PAIR, spans, (m) => ({
      start: m.index, end: m.index + m[0].length, open: m[0].slice(0, m[0].indexOf('>') + 1), close: `</${m[1]}>`,
    }))
    for (const re of [HTML_TAG, HTML_ENTITY, URL_RE]) collect(text, re, spans, whole)
    // Tags and entities inside a pair stay whole too.
    const nested: Span[] = []
    for (const pair of spans) {
      if (pair.open === undefined) continue
      const from = pair.start + pair.open.length
      const inner = text.slice(from, pair.end - (pair.close?.length ?? 0))
      for (const re of [HTML_TAG, HTML_ENTITY]) {
        re.lastIndex = 0
        for (let m = re.exec(inner); m; m = re.exec(inner)) nested.push({ start: from + m.index, end: from + m.index + m[0].length })
      }
    }
    return [...spans, ...nested]
  }
  collect(text, FENCE, spans, (m) => ({
    start: m.index, end: m.index + m[0].length, open: '```' + (m[1] ?? '') + '\n', close: '\n```',
  }))
  collect(text, INLINE_CODE, spans, (m) => ({ ...whole(m), open: '`', close: '`' }))
  if (format !== 'whatsapp') collect(text, MD_LINK, spans, whole)
  collect(text, URL_RE, spans, whole)
  for (const marker of format === 'whatsapp' ? WA_EMPHASIS : MD_EMPHASIS) {
    collect(text, emphasisRe(marker), spans, (m) => ({ ...whole(m), open: marker, close: marker }))
  }
  return spans
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
}

function cutOf(text: string, { maxLength, maxBytes, format }: Limits): Cut {
  const limit = Math.max(1, fitLength(text, maxLength, maxBytes))
  const floor = Math.floor(limit * 0.3)
  const spans = findSpans(text, format)
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
      if (p > min && p <= room) return { at: p, close, open: host.open }
    }
  }

  // No markup-safe cut: any boundary, else a grapheme-safe hard cut (outside tags/entities).
  const any = bestBoundary(text, limit, 0, floor)
  if (any > 0) return { at: any, close: '', open: '' }
  let hard = graphemeCut(text, limit)
  const whole = spans.filter((s) => s.open === undefined && s.start > 0 && s.start < hard && hard < s.end)
  if (whole.length > 0) hard = Math.min(...whole.map((s) => s.start))
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
  return cutOf(text, limits).at
}

/**
 * Split `text` into parts that fit `limit`: a max length in UTF-16 code units, or
 * {@link SplitTextOptions} with `maxLength`, `maxBytes` (UTF-8) and the markup `format`.
 * Cuts land on natural boundaries (paragraph, line, sentence, word), never inside a
 * grapheme or a markup entity; a fenced block, inline code, emphasis run or HTML element
 * longer than the limit is closed and reopened across parts. Whitespace at a cut is
 * dropped (the indentation of the next line is kept); whitespace-only parts are dropped.
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
  const out: string[] = []
  let rest = text
  while (!fits(rest, limits.maxLength, limits.maxBytes)) {
    const cut = cutOf(rest, limits)
    const head = rest.slice(0, cut.at).trimEnd()
    if (head.trim() && head !== cut.open.trimEnd()) out.push(head + cut.close)
    let tail = rest.slice(cut.at)
    // Drop the whitespace at the cut, but keep the indentation of a line the cut starts.
    if (/^\s*\n/.test(tail)) tail = tail.replace(/^\s*\n/, '')
    else if (rest[cut.at - 1] !== '\n') tail = tail.replace(/^[ \t 　]+/, '')
    if (cut.open) tail = cut.open + tail
    // Defensive: every round must consume input.
    rest = tail.length < rest.length ? tail : rest.slice(Math.max(1, cut.at))
  }
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
