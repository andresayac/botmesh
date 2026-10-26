/**
 * Linear-time matching of form field `pattern`s. A pattern comes from a flow document
 * author and runs against untrusted answers, so a backtracking engine is a ReDoS risk
 * that no static check fully closes (adjacent quantifiers are polynomial, repeated
 * alternations exponential). The pattern is parsed into a small regular subset of
 * JavaScript syntax (no backreferences, no lookarounds) and matched with a Thompson NFA
 * simulation: O(answer length × states), whatever the pattern looks like.
 */

/** Upper bound of NFA states a pattern may expand to (bounded repeats are unrolled). */
export const PATTERN_MAX_STATES = 2000

type Node =
  | { t: 'char'; test: (ch: string) => boolean }
  | { t: 'assert'; k: '^' | '$' | 'b' | 'B' }
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; items: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number }

class PatternSyntaxError extends Error {}

/** Parse `source` (JavaScript syntax, no flags) into the supported subset; throws {@link PatternSyntaxError}. */
function parse(source: string): Node {
  let i = 0
  const single = (atom: string): ((ch: string) => boolean) => {
    const re = new RegExp(`^(?:${atom})$`)
    return (ch) => re.test(ch)
  }

  const parseAlt = (): Node => {
    const items = [parseSeq()]
    while (source[i] === '|') { i++; items.push(parseSeq()) }
    return items.length === 1 ? items[0]! : { t: 'alt', items }
  }

  const parseSeq = (): Node => {
    const items: Node[] = []
    while (i < source.length && source[i] !== '|' && source[i] !== ')') items.push(parseQuantified())
    return { t: 'seq', items }
  }

  const parseQuantified = (): Node => {
    let node = parseAtom()
    const ch = source[i]
    let min: number | undefined
    let max = Infinity
    if (ch === '*') { min = 0; i++ } else if (ch === '+') { min = 1; i++ } else if (ch === '?') { min = 0; max = 1; i++ } else if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i))
      if (m) {
        min = Number(m[1])
        max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3])
        i += m[0].length
      }
    }
    if (min === undefined) return node
    if (source[i] === '?') i++ // lazy: irrelevant for a whole-answer match
    if (node.t === 'assert') throw new PatternSyntaxError('an assertion cannot be repeated')
    node = { t: 'rep', node, min, max }
    return node
  }

  const parseAtom = (): Node => {
    const ch = source[i]!
    if (ch === '(') {
      i++
      if (source[i] === '?') {
        if (source.startsWith('?:', i)) i += 2
        else if (/^\?<[A-Za-z_$][\w$]*>/.test(source.slice(i))) i = source.indexOf('>', i) + 1
        else throw new PatternSyntaxError('lookarounds are not allowed')
      }
      const inner = parseAlt()
      if (source[i] !== ')') throw new PatternSyntaxError('unbalanced parenthesis')
      i++
      return inner
    }
    if (ch === '[') {
      const start = i
      i++
      if (source[i] === '^') i++
      while (i < source.length && source[i] !== ']') { if (source[i] === '\\') i++; i++ }
      if (i >= source.length) throw new PatternSyntaxError('unterminated character class')
      i++
      return { t: 'char', test: single(source.slice(start, i)) }
    }
    if (ch === '\\') {
      const next = source[i + 1] ?? ''
      if (/[1-9]/.test(next) || next === 'k') throw new PatternSyntaxError('backreferences are not allowed')
      if (next === 'b' || next === 'B') { i += 2; return { t: 'assert', k: next } }
      let length = 2
      if (next === 'x' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 2, i + 4))) length = 4
      else if (next === 'u' && /^[0-9A-Fa-f]{4}$/.test(source.slice(i + 2, i + 6))) length = 6
      else if (next === 'c') {
        if (!/[A-Za-z]/.test(source[i + 2] ?? '')) throw new PatternSyntaxError('unsupported escape \\c')
        length = 3
      } else if (next === '0' && /[0-9]/.test(source[i + 2] ?? '')) throw new PatternSyntaxError('octal escapes are not allowed')
      else if (next === '') throw new PatternSyntaxError('trailing backslash')
      const atom = source.slice(i, i + length)
      i += length
      return { t: 'char', test: single(atom) }
    }
    if (ch === '^' || ch === '$') { i++; return { t: 'assert', k: ch } }
    if (ch === '*' || ch === '+' || ch === '?') throw new PatternSyntaxError('nothing to repeat')
    i++
    if (ch === '.') return { t: 'char', test: single('.') }
    return { t: 'char', test: (c) => c === ch }
  }

  const node = parseAlt()
  if (i < source.length) throw new PatternSyntaxError('unbalanced parenthesis')
  return node
}

/** NFA size of `node`, saturating above the limit. */
function sizeOf(node: Node): number {
  switch (node.t) {
    case 'char':
    case 'assert': return 1
    case 'seq': return node.items.reduce((sum, item) => Math.min(sum + sizeOf(item), PATTERN_MAX_STATES + 1), 0)
    case 'alt': return node.items.reduce((sum, item) => Math.min(sum + sizeOf(item) + 1, PATTERN_MAX_STATES + 1), 0)
    case 'rep': {
      const body = sizeOf(node.node) + 1
      const copies = node.max === Infinity ? node.min + 1 : node.max
      return Math.min(body * copies, PATTERN_MAX_STATES + 1)
    }
  }
}

type State =
  | { k: 'char'; test: (ch: string) => boolean; out: number }
  | { k: 'split'; out: number; out2: number }
  | { k: 'assert'; a: '^' | '$' | 'b' | 'B'; out: number }
  | { k: 'match' }

/** Build the NFA backwards: every fragment is given the state it continues to. */
function build(node: Node, next: number, states: State[]): number {
  const add = (state: State): number => states.push(state) - 1
  switch (node.t) {
    case 'char': return add({ k: 'char', test: node.test, out: next })
    case 'assert': return add({ k: 'assert', a: node.k, out: next })
    case 'seq': {
      let cur = next
      for (let j = node.items.length - 1; j >= 0; j--) cur = build(node.items[j]!, cur, states)
      return cur
    }
    case 'alt': {
      let cur = build(node.items[node.items.length - 1]!, next, states)
      for (let j = node.items.length - 2; j >= 0; j--) cur = add({ k: 'split', out: build(node.items[j]!, next, states), out2: cur })
      return cur
    }
    case 'rep': {
      let cur: number
      if (node.max === Infinity) {
        const loop = add({ k: 'split', out: -1, out2: next })
        ;(states[loop] as { out: number }).out = build(node.node, loop, states)
        cur = loop
      } else {
        cur = next
        for (let j = node.min; j < node.max; j++) cur = add({ k: 'split', out: build(node.node, cur, states), out2: next })
      }
      for (let j = 0; j < node.min; j++) cur = build(node.node, cur, states)
      return cur
    }
  }
}

const WORD = /[A-Za-z0-9_]/
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch)

/** Compile `source` into a whole-answer matcher that runs in linear time. */
function compileMatcher(source: string): (input: string) => boolean {
  const ast = parse(source)
  if (sizeOf(ast) > PATTERN_MAX_STATES) throw new PatternSyntaxError(`the pattern expands to more than ${PATTERN_MAX_STATES} states; use smaller repeat counts`)
  const states: State[] = [{ k: 'match' }]
  const start = build(ast, 0, states)
  const seen = new Int32Array(states.length).fill(-1)

  return (input) => {
    let generation = 0
    const closure = (from: readonly number[], pos: number): number[] => {
      const out: number[] = []
      const stack = [...from].reverse()
      const mark = generation++
      while (stack.length) {
        const s = stack.pop()!
        if (seen[s] === mark) continue
        seen[s] = mark
        const state = states[s]!
        if (state.k === 'split') { stack.push(state.out2, state.out) } else if (state.k === 'assert') {
          const ok = state.a === '^' ? pos === 0
            : state.a === '$' ? pos === input.length
              : (isWord(input[pos - 1]) !== isWord(input[pos])) === (state.a === 'b')
          if (ok) stack.push(state.out)
        } else out.push(s)
      }
      return out
    }
    seen.fill(-1)
    let current = closure([start], 0)
    for (let pos = 0; pos < input.length && current.length; pos++) {
      const ch = input[pos]!
      const moved: number[] = []
      for (const s of current) {
        const state = states[s]!
        if (state.k === 'char' && state.test(ch)) moved.push(state.out)
      }
      current = closure(moved, pos + 1)
    }
    return current.includes(0)
  }
}

/** Why `source` cannot be a form pattern (unsupported syntax or too large), or `undefined`. */
export function linearPatternIssue(source: string): string | undefined {
  try {
    compileMatcher(source)
    return undefined
  } catch (error) {
    if (error instanceof PatternSyntaxError) return error.message
    return 'must be a valid regular expression'
  }
}

/**
 * A `RegExp` whose `test`/`exec` match the **whole** input with the linear engine. Its
 * `source` is the author's pattern, so introspection and export see the original text.
 */
class LinearPattern extends RegExp {
  readonly #matches: (input: string) => boolean

  constructor(source: string | RegExp) {
    super(source)
    this.#matches = compileMatcher(typeof source === 'string' ? source : source.source)
  }

  override test(input: string): boolean {
    return this.#matches(String(input))
  }

  override exec(input: string): RegExpExecArray | null {
    const text = String(input)
    if (!this.#matches(text)) return null
    return Object.assign([text], { index: 0, input: text, groups: undefined }) as RegExpExecArray
  }
}

/** Compile a validated form `pattern` into a linear-time, whole-answer `RegExp`. */
export function compileFormPattern(source: string): RegExp {
  return new LinearPattern(source)
}
