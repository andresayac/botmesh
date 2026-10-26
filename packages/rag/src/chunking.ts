/**
 * Text chunking: paragraphs → sentences → words → characters, greedily packed
 * up to `chunkSize` characters, with an optional word-aligned overlap carried
 * from the previous chunk. Markdown documents are first split by headings so a
 * chunk never straddles two sections, and each chunk is tagged with (and
 * prefixed by) its heading path — which also helps retrieval.
 */

import { RagError } from './errors.js'
import type { RagChunk, RagDocument } from './types.js'

export interface ChunkOptions {
  /** Target max characters per chunk (before the overlap). Default 1000. */
  chunkSize?: number
  /** Characters carried over from the previous chunk. Default 150 (must be < chunkSize). */
  chunkOverlap?: number
}

export const DEFAULT_CHUNK_SIZE = 1000
export const DEFAULT_CHUNK_OVERLAP = 150

/** Normalise and validate chunk options. Throws `RagError('INVALID_OPTIONS')`. */
export function resolveChunkOptions(options: ChunkOptions = {}): Required<ChunkOptions> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkOverlap = options.chunkOverlap ?? Math.min(DEFAULT_CHUNK_OVERLAP, Math.floor(chunkSize / 4))
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new RagError('INVALID_OPTIONS', 'chunkSize must be a positive integer')
  }
  if (!Number.isSafeInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new RagError('INVALID_OPTIONS', 'chunkOverlap must be a non-negative integer smaller than chunkSize')
  }
  return { chunkSize, chunkOverlap }
}

interface Unit { text: string; /** First unit of a paragraph (joined with a blank line). */ para: boolean }

/** Break `text` into pieces no longer than `max`, preferring natural boundaries. */
function units(text: string, max: number): Unit[] {
  const out: Unit[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const p = paragraph.trim()
    if (!p) continue
    let para = true
    const push = (t: string) => { out.push({ text: t, para }); para = false }
    if (p.length <= max) { push(p); continue }
    for (const sentence of p.split(/(?<=[.!?…;])\s+/)) {
      const s = sentence.trim()
      if (!s) continue
      if (s.length <= max) { push(s); continue }
      let line = ''
      for (const word of s.split(/\s+/)) {
        if (word.length > max) {
          if (line) { push(line); line = '' }
          for (const piece of hardSplit(word, max)) push(piece)
          continue
        }
        const next = line ? `${line} ${word}` : word
        if (next.length > max) { push(line); line = word } else line = next
      }
      if (line) push(line)
    }
  }
  return out
}

/** Cut `word` into pieces of at most `max` UTF-16 units, never between the two halves of a surrogate pair. */
function hardSplit(word: string, max: number): string[] {
  const out: string[] = []
  let i = 0
  while (i < word.length) {
    let end = Math.min(i + max, word.length)
    // Do not leave a lone high surrogate at the end of a piece (unless max is 1).
    if (end < word.length && end - i > 1 && isHighSurrogate(word.charCodeAt(end - 1))) end--
    out.push(word.slice(i, end))
    i = end
  }
  return out
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

/** Last `overlap` characters of `text`, starting at a word boundary. */
function tail(text: string, overlap: number): string {
  if (overlap <= 0 || !text) return ''
  if (text.length <= overlap) return text
  const slice = text.slice(text.length - overlap)
  const space = slice.search(/\s/)
  return space === -1 ? '' : slice.slice(space).trim()
}

/**
 * Split plain text into chunks of at most `chunkSize` characters of new
 * content (a chunk may additionally start with up to `chunkOverlap` characters
 * carried from the previous one).
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { chunkSize, chunkOverlap } = resolveChunkOptions(options)
  const chunks: string[] = []
  let current = ''
  for (const unit of units(text, chunkSize)) {
    const sep = current ? (unit.para ? '\n\n' : ' ') : ''
    if (current && current.length + sep.length + unit.text.length > chunkSize) {
      chunks.push(current)
      const carried = tail(current, chunkOverlap)
      current = carried ? `${carried} ${unit.text}` : unit.text
      continue
    }
    current = `${current}${sep}${unit.text}`
  }
  if (current) chunks.push(current)
  return chunks
}

export interface MarkdownSection {
  /** Heading path joined with `' › '`; `''` for text before the first heading. */
  path: string
  body: string
}

/**
 * An ATX heading (`## Title`, optionally closed by `##`), parsed in linear time: a
 * backtracking regex over the title made a line padded with spaces take minutes.
 * A closing `#` run only counts when a space precedes it, so `## C#` keeps its `#`.
 */
function parseHeading(line: string): { level: number; title: string } | undefined {
  const m = /^(#{1,6})[ \t]+(\S.*)$/.exec(line)
  if (!m) return undefined
  let title = m[2]!.trimEnd()
  let end = title.length
  while (end > 0 && title[end - 1] === '#') end--
  if (end < title.length && (end === 0 || /[ \t]/.test(title[end - 1]!))) title = title.slice(0, end).trimEnd()
  return title ? { level: m[1]!.length, title } : undefined
}

/** Split markdown into sections by ATX headings (`#`..`######`), ignoring fenced code. */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = []
  const stack: { level: number; title: string }[] = []
  let body: string[] = []
  let inFence = false
  const flush = () => {
    const text = body.join('\n').trim()
    if (text) sections.push({ path: stack.map((h) => h.title).join(' › '), body: text })
    body = []
  }
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = inFence ? undefined : parseHeading(line)
    if (!heading) { body.push(line); continue }
    flush()
    while (stack.length && stack[stack.length - 1]!.level >= heading.level) stack.pop()
    stack.push(heading)
  }
  flush()
  return sections
}

/** Chunk one document (heading-aware for markdown). */
export function chunkDocument(doc: RagDocument, options: ChunkOptions = {}): RagChunk[] {
  const resolved = resolveChunkOptions(options)
  const parts: { section?: string; text: string }[] = []
  if (doc.format === 'markdown') {
    for (const s of splitMarkdownSections(doc.text)) {
      const prefix = s.path ? `${s.path}\n\n` : ''
      const room = Math.max(resolved.chunkOverlap + 1, resolved.chunkSize - prefix.length)
      for (const text of chunkText(s.body, { chunkSize: room, chunkOverlap: resolved.chunkOverlap })) {
        parts.push(s.path ? { section: s.path, text: `${prefix}${text}` } : { text })
      }
    }
  } else {
    for (const text of chunkText(doc.text, resolved)) parts.push({ text })
  }
  return parts.map((part, index) => {
    const chunk: RagChunk = { id: `${doc.id}#${index}`, docId: doc.id, source: doc.source, index, text: part.text }
    if (part.section) chunk.section = part.section
    if (doc.metadata) chunk.metadata = { ...doc.metadata }
    return chunk
  })
}
