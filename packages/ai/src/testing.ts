/**
 * `@botmesh/ai/testing` — test doubles and helpers for bots that use `@botmesh/ai`.
 *
 * Semver-covered like the main entry. `MockAIProvider` answers scripted text or tool calls
 * without any SDK or network; `validateArgs` checks a tool's arguments against its schema the
 * same way the tool loop does, to unit-test a tool definition.
 *
 * @example
 * ```ts
 * import { aiPlugin } from '@botmesh/ai'
 * import { MockAIProvider } from '@botmesh/ai/testing'
 *
 * bot.plug(aiPlugin({ instance: new MockAIProvider({ reply: 'hello' }) }))
 * ```
 *
 * @packageDocumentation
 */

export { MockAIProvider } from './MockAIProvider.js'
export type { MockOptions, MockTurn } from './MockAIProvider.js'
export { validateArgs } from './tools/schema.js'
export type { ArgsValidation } from './tools/schema.js'
