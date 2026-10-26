/**
 * nluPlugin — install an {@link IntentEngine} on a Bot.
 *
 * Exposes the engine as `ctx.tools.nlu` (typed via module augmentation of
 * `@botmesh/core`'s `DefaultTools`) and optionally seeds it with intents from
 * config. Pair it with {@link whenIntent} to route messages by intent.
 *
 * @example
 * ```ts
 * import { nluPlugin, whenIntent } from '@botmesh/nlu'
 *
 * bot.plug(nluPlugin, {
 *   threshold: 0.5,
 *   intents: {
 *     greeting: ['hola', 'buenas'],
 *     'order.status': ['mi pedido {id}', 'estado de mi pedido'],
 *   },
 * })
 *
 * const nlu = bot.injectTools.nlu!
 * whenIntent(bot, nlu, 'greeting', (ctx) => ctx.reply('¡Hola! 👋'))
 * ```
 */

import { definePlugin } from '@botmesh/core'
import { IntentEngine } from './IntentEngine.js'

export interface NluPluginConfig {
  /** Minimum confidence for matches (default `0.5`). */
  threshold?: number
  /** Seed intents: `{ intentName: [utterance, ...] }`. Slot syntax `{name}` is supported. */
  intents?: Record<string, string[]>
}

export const nluPlugin = definePlugin<NluPluginConfig>({
  name: 'nlu',
  version: '0.1.0',
  description: 'Lightweight local intent matching for @botmesh/core — no external services.',
  install(ctx, config = {}) {
    const intents: unknown = config.intents ?? {}
    if (typeof intents !== 'object' || intents === null || Array.isArray(intents)) {
      throw new Error(
        `nluPlugin: intents must be an object like { greeting: ['hi', 'hello'] }, got ${Array.isArray(intents) ? 'an array' : typeof intents}`,
      )
    }
    const engine = new IntentEngine({ threshold: config.threshold })
    for (const [intent, utterances] of Object.entries(intents as Record<string, string[]>)) {
      engine.define(intent, utterances)
    }
    ctx.tools.nlu = engine
    ctx.onDispose(() => {
      if (ctx.tools.nlu === engine) delete ctx.tools.nlu
    })
    ctx.logger.debug({ intents: engine.intents(), threshold: engine.threshold }, 'nlu engine installed')
  },
})
