/**
 * whenDialogflowIntent — route a Dialogflow intent to a handler or a flow,
 * through a `bot.when` predicate (like `@botmesh/nlu`'s `whenIntent`).
 *
 * The predicate reads the result the plugin's `before('message')` hook stored
 * for the message, so it is synchronous and does not call Dialogflow again.
 * For flows, the intent parameters are copied into `c.state` before the first
 * step runs.
 */

import {
  isCompiledFlow,
  type FlowBuilder,
  type Bot,
  type CompiledFlow,
  type CompiledStep,
  type MessageContext,
} from '@botmesh/core'
import type { DialogflowResult } from './client.js'
import type { DialogflowContext } from './context.js'
import { checkConfidence } from './validate.js'

/** Handler for an intent-matched message; receives the context plus the Dialogflow result. */
export type DialogflowIntentHandler = (ctx: MessageContext, result: DialogflowResult) => unknown | Promise<unknown>

/** What an intent routes to. */
export type IntentTarget = DialogflowIntentHandler | FlowBuilder | CompiledFlow

export interface WhenDialogflowIntentOptions {
  /** Override the context's `minConfidence` for this route. */
  minConfidence?: number
  /** Flows only: nest the parameters under `c.state[stateKey]` instead of spreading them. */
  stateKey?: string
}

/** Keys that would reach an object's prototype when assigned. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * The parameters as a plain object without prototype-reaching keys: they come from a remote
 * service, and `Object.assign` with an own `__proto__` key would replace c.state's prototype.
 */
function safeParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parameters)) if (!UNSAFE_KEYS.has(key)) out[key] = value
  return out
}

/** A flow() builder, of this or another copy of @botmesh/core (so no `instanceof`). */
function isFlowBuilder(x: unknown): x is FlowBuilder {
  return typeof x === 'object' && x !== null && typeof (x as { compile?: unknown }).compile === 'function'
}

/**
 * Prepend a step that copies the matched parameters into `c.state`.
 *
 * The wrapped flow gets its own id (`<id>#dialogflow`, plus `:<stateKey>` when
 * nested). The runtime registers flows by id, so reusing the original id would
 * let a plain registration of the same flow (`bot.when`, `bot.use`) replace the
 * wrapped one or be replaced by it, and the extra step would shift the step
 * indices that `.persistent()` checkpoints are keyed on.
 */
export function withDialogflowState(flow: CompiledFlow, df: DialogflowContext, stateKey?: string): CompiledFlow {
  const inject: CompiledStep = {
    kind: 'do',
    fn: (ctx, c) => {
      const result = df.resultFor(ctx)
      if (!result) return
      if (stateKey) c.state[stateKey] = safeParameters(result.parameters)
      else Object.assign(c.state, safeParameters(result.parameters))
    },
  }
  const id = `${flow.id}#dialogflow${stateKey ? `:${stateKey}` : ''}`
  return { ...flow, id, steps: [inject, ...flow.steps] }
}

/**
 * Run `target` when the message's Dialogflow intent is `intent` (or one of
 * `intent[]`) with confidence ≥ `minConfidence`. Returns an unsubscribe
 * function, like `bot.when`. Non-matching messages fall through.
 *
 * @example
 * ```ts
 * const df = bot.injectTools.dialogflow!
 * whenDialogflowIntent(bot, df, 'order.status', (ctx, r) => ctx.reply(`Pedido ${String(r.parameters.order)}`))
 * whenDialogflowIntent(bot, df, 'book.table', flow('book').ask('¿Para cuántas personas?', 'people'))
 * ```
 */
export function whenDialogflowIntent(
  bot: Pick<Bot, 'when'>,
  df: DialogflowContext,
  intent: string | readonly string[],
  target: IntentTarget,
  opts: WhenDialogflowIntentOptions = {},
): () => void {
  const intents = typeof intent === 'string' ? [intent] : [...intent]
  if (intents.length === 0 || intents.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError(`whenDialogflowIntent(${JSON.stringify(intents)}): intent must be a non-empty display name or a non-empty list of them`)
  }
  checkConfidence(opts.minConfidence)
  const predicate = (c: { body: string; isGroup: boolean }) => df.matches(df.resultFor(c), intents, opts.minConfidence)

  let unsub: () => void
  if (typeof target !== 'function') {
    if (!isFlowBuilder(target) && !isCompiledFlow(target)) {
      throw new TypeError(`whenDialogflowIntent(${JSON.stringify(intents)}): target must be a handler function, a flow() builder or a compiled flow`)
    }
    const compiled = isFlowBuilder(target) ? target.compile() : target
    unsub = bot.when(predicate, withDialogflowState(compiled, df, opts.stateKey))
  } else {
    const handler = target
    unsub = bot.when(predicate, (ctx) => {
      const result = df.resultFor(ctx)
      if (result) return handler(ctx, result)
      ctx.pass()
    })
  }
  const unmark = intents.map((name) => df.markRouted(name))
  return () => {
    unsub()
    for (const u of unmark) u()
  }
}
