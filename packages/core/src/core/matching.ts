/**
 * Trigger matching: text normalization (accent/case/space folding), whether a trigger
 * matches a message (text equality by default, RegExp, function, type and object
 * triggers with scope/strategy) and each trigger's specificity, which orders the
 * Dispatcher's matchers. Pure functions: no routing, no state.
 */
import type { Trigger, TriggerObject, MatchStrategy, TriggerScope } from './types.js'
import type { MessageType } from './provider.js'
import { isTypeTrigger, isWelcomeTrigger, typeTriggerSpecificity, WELCOME_SPECIFICITY } from './triggers.js'

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** `type` is only read by type triggers (the dispatcher always passes the full context). */
interface MatchInput { body: string; isGroup: boolean; type?: string }

function isTriggerObject(t: Trigger): t is TriggerObject {
  return typeof t === 'object' && t !== null && !(t instanceof RegExp) && !Array.isArray(t) && 'pattern' in t
}

function inScope(scope: TriggerScope | undefined, isGroup: boolean): boolean {
  if (scope === 'dm') return !isGroup
  if (scope === 'group') return isGroup
  return true
}

/** A text pattern the matcher can compare (numbers are kept for JavaScript menus: `when(1)`). */
function isPattern(p: unknown): boolean {
  return typeof p === 'string' || p instanceof RegExp || (typeof p === 'number' && Number.isFinite(p))
}

/**
 * Throw a `TypeError` for a trigger no one can mean. `undefined`/`null` (an unset env var,
 * a missing import) used to be stringified and matched the literal text "undefined" or
 * "null". An empty or blank text pattern (`''`, `'  '`, `['hola', '']`) used to match every
 * message without text (a photo without caption) — or every message with `contains` /
 * `startsWith` / `endsWith` — so it throws too. `[]` stays valid: it never matches and is
 * the usual trigger of a flow entered only by `goto`.
 */
export function assertTrigger(trigger: unknown, where = 'trigger'): void {
  if (typeof trigger === 'function' || isTypeTrigger(trigger as Trigger) || isWelcomeTrigger(trigger as Trigger)) return
  const bad = (what: unknown): never => {
    throw new TypeError(
      `Invalid trigger for ${where}: ${describeValue(what)}. Use a string, a RegExp, an array of them, ` +
        '{ pattern, match?, scope? }, a predicate function or a trigger constant (WELCOME, IMAGE, ...)',
    )
  }
  const check = (p: unknown): void => {
    if (!isPattern(p)) bad(p)
    if (typeof p === 'string' && normalizeText(p) === '') {
      throw new TypeError(
        `Invalid trigger for ${where}: an empty text pattern (${JSON.stringify(p)}) would match every message ` +
          'without text (or every message with contains/startsWith/endsWith). Use a type trigger such as IMAGE or MEDIA ' +
          'for media, bot.onMessage() for a catch-all, or [] for a flow entered only by goto()',
      )
    }
  }
  if (Array.isArray(trigger)) { for (const p of trigger) check(p); return }
  if (typeof trigger === 'object' && trigger !== null && !(trigger instanceof RegExp) && 'pattern' in trigger) {
    const { pattern } = trigger as { pattern: unknown }
    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    for (const p of patterns) check(p)
    return
  }
  check(trigger)
}

function describeValue(v: unknown): string {
  if (v === undefined || v === null) return String(v)
  if (typeof v === 'object') return 'an object without a pattern'
  return `${typeof v} ${String(v)}`
}

/**
 * Synchronous match. For `WELCOME` this only checks the scope — the first-contact
 * decision is asynchronous and made by the Dispatcher (see `core/welcome.ts`).
 */
export function matchTrigger(trigger: Trigger, ctx: MatchInput): boolean {
  if (typeof trigger === 'function') return trigger(ctx)
  if (isTypeTrigger(trigger)) {
    return inScope(trigger.scope, ctx.isGroup) && trigger.types.includes(ctx.type as MessageType)
  }
  if (isWelcomeTrigger(trigger)) return inScope(trigger.scope, ctx.isGroup)

  const obj: TriggerObject = isTriggerObject(trigger) ? trigger : { pattern: trigger as TriggerObject['pattern'] }
  const scope = obj.scope ?? 'all'
  if (scope === 'dm' && ctx.isGroup) return false
  if (scope === 'group' && !ctx.isGroup) return false

  const patterns = Array.isArray(obj.pattern) ? obj.pattern : [obj.pattern]
  const strategy: MatchStrategy = obj.match ?? 'equals'
  const body = normalizeText(ctx.body ?? '')

  return patterns.some((p) => {
    // Intentional: RegExp patterns run against the RAW body (no normalization) —
    // regex authors control their own flags and diacritics handling.
    if (p instanceof RegExp) {
      p.lastIndex = 0
      const matched = p.test(ctx.body ?? '')
      p.lastIndex = 0
      return matched
    }
    const text = normalizeText(String(p))
    switch (strategy) {
      case 'contains': return body.includes(text)
      case 'startsWith': return body.startsWith(text)
      case 'endsWith': return body.endsWith(text)
      case 'equals':
      default: return body === text
    }
  })
}

const STRATEGY_SPECIFICITY: Record<MatchStrategy, number> = {
  equals: 40,
  startsWith: 30,
  endsWith: 25,
  contains: 10,
}

export function triggerSpecificity(trigger: Trigger): number {
  if (typeof trigger === 'function') return 5
  if (isWelcomeTrigger(trigger)) return WELCOME_SPECIFICITY
  if (isTypeTrigger(trigger)) return typeTriggerSpecificity(trigger)
  if (trigger instanceof RegExp) return 20
  if (Array.isArray(trigger)) {
    if (trigger.length === 0) return 0 // never matches → lowest priority
    return Math.max(...trigger.map((p) => triggerSpecificity(p)))
  }
  if (isTriggerObject(trigger)) {
    const patterns = Array.isArray(trigger.pattern) ? trigger.pattern : [trigger.pattern]
    if (patterns.length === 0) return 0 // never matches → lowest priority
    const tier = STRATEGY_SPECIFICITY[trigger.match ?? 'equals']
    // Per-element, combined with max — same rule as top-level arrays:
    // RegExp element → 20; string element → tier of the match strategy.
    return Math.max(...patterns.map((p) => (p instanceof RegExp ? 20 : tier)))
  }
  return 40 // string plano = equals
}
