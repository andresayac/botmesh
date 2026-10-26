/**
 * IntentEngine — lightweight, fully-local intent matching.
 *
 * Register intents with training phrases (utterances), then score incoming
 * text against them. No network, no ML models, no dependencies: scoring is a
 * deterministic blend of token-overlap (Jaccard), utterance coverage and
 * whole-utterance containment over normalized text (lowercased, diacritics
 * and punctuation stripped).
 *
 * Utterances may contain `{slot}` placeholders to capture a single
 * whitespace-delimited token, e.g. `'mi pedido {id}'` matches
 * `'mi pedido 123'` and extracts `{ id: '123' }`.
 *
 * @example
 * ```ts
 * import { IntentEngine } from '@botmesh/nlu'
 *
 * const nlu = new IntentEngine() // default threshold 0.5
 * nlu.define('greeting', ['hola', 'buenas', 'buenos días'])
 * nlu.define('order.status', ['mi pedido {id}', 'estado de mi pedido'])
 *
 * nlu.match('¡Hola!')                 // → { intent: 'greeting', confidence: 1 }
 * nlu.match('mi pedido 12345')        // → { intent: 'order.status', confidence: 1, entities: { id: '12345' } }
 * nlu.match('zzz qqq')                // → null (below threshold)
 * ```
 */

/** Result of a successful match: the winning intent, its score and any captured slots. */
export interface IntentMatch {
  /** Name of the matched intent (as passed to {@link IntentEngine.define}). */
  intent: string
  /** Score in `[0, 1]`; `1` is an exact (normalized) or full slot-pattern match. */
  confidence: number
  /** Slot values captured from `{slot}` placeholders, when the utterance pattern matched. */
  entities?: Record<string, string>
}

export interface IntentEngineOptions {
  /** Minimum confidence for {@link IntentEngine.match} to return a result. Default `0.5`. */
  threshold?: number
}

/** Scoring weights (fixed, documented in the README). */
const W_JACCARD = 0.3
const W_COVERAGE = 0.5
const W_CONTAINS = 0.2

const SLOT_SEGMENT = /^\{([A-Za-z_]\w*)\}$/
const SLOT_SPLITTER = /(\{[A-Za-z_]\w*\})/

interface CompiledUtterance {
  /** Normalized literal text (slots removed). */
  normalized: string
  /** `normalized` padded with spaces, for whole-word containment. */
  bounded: string
  /** Distinct normalized literal tokens (slots removed); scores compare token sets. */
  tokens: string[]
  /** Slot names in order of appearance. */
  slotNames: string[]
  /** Full-input regex when the utterance has slots, else null. */
  regex: RegExp | null
}

/**
 * Optional marks removed like Latin accents: combining diacritics (U+0300–U+036F),
 * Hebrew points and cantillation, and Arabic harakat / Quranic annotation marks. Marks of
 * other scripts (Devanagari, Thai, Bengali vowel signs…) are part of the letter and stay.
 */
const OPTIONAL_MARKS =
  /[\u0300-\u036f\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed]/g
/** Invisible format characters (zero-width space/joiners, soft hyphen, BOM, bidi marks). */
const FORMAT_CHARS = /\p{Cf}/gu
/** Anything that is not a letter, a mark kept above, a digit or whitespace becomes a space. */
const NON_WORD = /[^\p{L}\p{M}\p{N}\s]+/gu

/** Fold one piece of text without collapsing whitespace (shared by both normalizers). */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(OPTIONAL_MARKS, '')
    .replace(FORMAT_CHARS, '')
    .toLowerCase()
    .replace(NON_WORD, ' ')
    .normalize('NFC')
}

/**
 * Normalize text for matching: compatibility-decompose (NFKD: full-width letters and
 * ligatures fold to plain ones), strip accents and other optional diacritics (Latin,
 * Hebrew points, Arabic harakat), drop invisible format characters, lowercase, replace
 * every character that is not a letter, a digit or a script's own combining mark with a
 * space, collapse whitespace and trim. Deterministic and locale-independent.
 */
export function normalizeText(text: string): string {
  return fold(text).replace(/\s+/g, ' ').trim()
}

/** Loose normalize (no collapse/trim) — keeps spacing between segments intact. */
function loose(text: string): string {
  return fold(text)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileUtterance(raw: string): CompiledUtterance {
  const where = `IntentEngine.define: utterance ${JSON.stringify(raw)}`
  // Fold the literal pieces first and drop the ones that fold to nothing (an emoji, a lone
  // accent): `{a}` + U+0301 + `{b}` must count as adjacent slots, like `{a}{b}`.
  const segments: Array<{ slot: string } | { text: string }> = []
  for (const seg of raw.split(SLOT_SPLITTER)) {
    const m = SLOT_SEGMENT.exec(seg)
    if (m) {
      const prev = segments[segments.length - 1]
      if (prev && 'slot' in prev) {
        // `(\S+)(\S+)` is ambiguous (which token boundary?) and backtracks quadratically on a
        // long token, so a crafted message could stall the chat queue.
        throw new Error(`${where} has adjacent slots {${prev.slot}}{${m[1]}}; separate them with a space or a word`)
      }
      segments.push({ slot: m[1] })
    } else {
      const text = loose(seg)
      if (text !== '') segments.push({ text })
    }
  }
  const slotNames: string[] = []
  const withSlots: string[] = []
  const withoutSlots: string[] = []
  for (const seg of segments) {
    if ('slot' in seg) {
      if (seg.slot === '__proto__') throw new Error(`${where}: slot name {__proto__} is reserved; rename it`)
      if (slotNames.includes(seg.slot)) throw new Error(`${where}: slot {${seg.slot}} appears twice; give each slot its own name`)
      slotNames.push(seg.slot)
      withSlots.push(`{${seg.slot}}`)
      withoutSlots.push(' ')
    } else {
      withSlots.push(seg.text)
      withoutSlots.push(seg.text)
    }
  }
  const normalized = normalizeText(withoutSlots.join(''))
  if (normalized === '' && slotNames.length === 0) {
    throw new Error(
      `${where} has no letters or digits after normalization (emoji and punctuation are ignored), so it would never match`,
    )
  }
  const tokens = normalized ? [...new Set(normalized.split(' '))] : []
  let regex: RegExp | null = null
  if (slotNames.length > 0) {
    // Build the pattern from the loose-normalized segments directly (a full
    // normalizeText pass would strip the `{` `}` markers that delimit slots).
    const body = withSlots
      .map((seg, i) => {
        if (!SLOT_SEGMENT.test(seg)) return escapeRegExp(seg)
        // A slot glued to the next slot by a literal with no whitespace (`{qty}x{item}`) would
        // compile to `(\S+)x(\S+)`, which backtracks quadratically on one long token. Stop the
        // slot at the literal's first character instead: linear, and that slot never contains
        // the separator (the ambiguous case anyway).
        const glue = withSlots[i + 1]
        const following = withSlots[i + 2]
        if (glue !== undefined && following !== undefined && SLOT_SEGMENT.test(following) && /^\S+$/u.test(glue)) {
          return `([^\\s${escapeRegExp(String.fromCodePoint(glue.codePointAt(0) as number))}]+)`
        }
        return '(\\S+)'
      })
      .join('')
      .trim()
      .replace(/\s+/g, '\\s+')
    regex = new RegExp(`^${body}$`, 'u')
  }
  return { normalized, bounded: ` ${normalized} `, tokens, slotNames, regex }
}

function typeOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

function copyMatch(m: IntentMatch): IntentMatch {
  return m.entities ? { ...m, entities: { ...m.entities } } : { ...m }
}

function checkThreshold(threshold: unknown): number {
  if (typeof threshold !== 'number' || Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`IntentEngine: threshold must be a number in [0, 1], got ${String(threshold)}`)
  }
  return threshold
}

/**
 * Deterministic local intent matcher. See the package README for the scoring
 * formula and its limits (it is NOT a full ML NLU).
 */
export class IntentEngine {
  private readonly registry = new Map<string, CompiledUtterance[]>()
  private readonly defaultThreshold: number
  /**
   * Scores of the last text ranked: several `whenIntent` matchers (and the handler that
   * fires) look up the same message, so it is scored once. `define()` clears it.
   */
  private lastRanked: { text: string; ranked: IntentMatch[] } | undefined

  constructor(options: IntentEngineOptions = {}) {
    this.defaultThreshold = checkThreshold(options.threshold ?? 0.5)
  }

  /** Minimum confidence `match()` requires (constructor value). */
  get threshold(): number {
    return this.defaultThreshold
  }

  /**
   * Add training phrases to an intent. Calling `define` again for an existing
   * intent APPENDS utterances (it does not replace them). Returns `this` for
   * chaining.
   */
  define(intent: string, utterances: string[]): this {
    if (typeof intent !== 'string' || intent.trim() === '') {
      throw new Error('IntentEngine.define: intent must be a non-empty string')
    }
    if (!Array.isArray(utterances)) {
      throw new Error(`IntentEngine.define("${intent}"): utterances must be an array of strings`)
    }
    utterances.forEach((u, i) => {
      if (typeof u !== 'string') {
        throw new Error(`IntentEngine.define("${intent}"): utterances must be strings, got ${typeOf(u)} at index ${i}`)
      }
    })
    const clean = utterances.filter((u) => u.trim() !== '')
    if (clean.length === 0) {
      throw new Error(`IntentEngine.define("${intent}"): provide at least one non-empty utterance`)
    }
    // Compile everything first so a bad utterance leaves the intent untouched.
    const compiled = clean.map(compileUtterance)
    this.registry.set(intent, [...(this.registry.get(intent) ?? []), ...compiled])
    this.lastRanked = undefined
    return this
  }

  /** Names of every registered intent, in definition order. */
  intents(): string[] {
    return [...this.registry.keys()]
  }

  /**
   * Best match at or above `threshold` (default: the engine threshold), or
   * `null` when nothing qualifies. Ties resolve deterministically to the
   * earliest-defined intent.
   */
  match(text: string, threshold: number = this.defaultThreshold): IntentMatch | null {
    checkThreshold(threshold)
    const best = this.ranked(text, 'match')[0]
    return best && best.confidence >= threshold ? copyMatch(best) : null
  }

  /**
   * Score every intent against `text` and return all positive scores sorted
   * by confidence (descending; ties keep definition order). Useful for
   * debugging and disambiguation UIs.
   */
  rank(text: string): IntentMatch[] {
    return this.ranked(text, 'rank').map(copyMatch)
  }

  /** Shared, cached ranking. Callers copy what they hand out. */
  private ranked(text: string, method: string): IntentMatch[] {
    if (typeof text !== 'string') throw new TypeError(`IntentEngine.${method}: text must be a string, got ${typeOf(text)}`)
    if (this.lastRanked?.text === text) return this.lastRanked.ranked
    const ranked = this.scoreAll(text)
    this.lastRanked = { text, ranked }
    return ranked
  }

  private scoreAll(text: string): IntentMatch[] {
    const input = normalizeText(text)
    if (!input) return []
    const inputSet = new Set(input.split(' '))
    const padded = ` ${input} ` // word-boundary containment checks
    const out: IntentMatch[] = []
    for (const [intent, utterances] of this.registry) {
      let best: IntentMatch | undefined
      for (const u of utterances) {
        const scored = this.scoreUtterance(u, input, padded, inputSet)
        if (scored.confidence > 0 && (!best || scored.confidence > best.confidence)) {
          best = { intent, confidence: scored.confidence, ...(scored.entities ? { entities: scored.entities } : {}) }
        }
      }
      if (best) out.push(best)
    }
    out.sort((a, b) => b.confidence - a.confidence) // stable: ties keep definition order
    return out
  }

  private scoreUtterance(
    u: CompiledUtterance,
    input: string,
    padded: string,
    inputSet: Set<string>,
  ): { confidence: number; entities?: Record<string, string> } {
    // Slot utterances: a full pattern match scores 1 and captures entities.
    if (u.regex) {
      const m = u.regex.exec(input)
      if (m) {
        const entities: Record<string, string> = {}
        u.slotNames.forEach((name, i) => {
          entities[name] = m[i + 1]
        })
        return { confidence: 1, entities }
      }
    } else if (u.normalized.length > 0 && input === u.normalized) {
      // Exact match on normalized text (case/diacritics/punctuation-insensitive).
      return { confidence: 1 }
    }
    if (u.tokens.length === 0) return { confidence: 0 }

    let intersection = 0
    for (const t of u.tokens) if (inputSet.has(t)) intersection++
    if (intersection === 0) return { confidence: 0 }

    const union = u.tokens.length + inputSet.size - intersection
    const jaccard = intersection / union // token-overlap symmetry
    const coverage = intersection / u.tokens.length // how much of the utterance the input covers
    const contains = u.normalized.length > 0 && padded.includes(u.bounded) ? 1 : 0 // whole words only
    return { confidence: W_JACCARD * jaccard + W_COVERAGE * coverage + W_CONTAINS * contains }
  }
}
