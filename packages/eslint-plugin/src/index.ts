/**
 * eslint-plugin-botmesh — static lint rules for @botmesh bots.
 *
 * Complements the runtime `bot.lint()` / `lintFlows()` (broken gotos,
 * unreachable steps, duplicate triggers…) with source-level checks that need
 * no running bot.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import botmesh from 'eslint-plugin-botmesh'
 *
 * export default [
 *   botmesh.configs.recommended,
 *   // or pick rules:
 *   { plugins: { 'botmesh': botmesh }, rules: { 'botmesh/require-timeout-on-ask': ['error', { methods: ['ask', 'choose'] }] } },
 * ]
 * ```
 */

import { readFileSync } from 'node:fs'

import type { ESLint, Linter, Rule } from 'eslint'

import { noAsyncPluginInstall } from './rules/noAsyncPluginInstall.js'
import { noAwaitRuntimeEnter } from './rules/noAwaitRuntimeEnter.js'
import { noEmptyTrigger } from './rules/noEmptyTrigger.js'
import { noV1Api } from './rules/noV1Api.js'
import { preferCtxUser } from './rules/preferCtxUser.js'
import { requireTimeoutOnAsk } from './rules/requireTimeoutOnAsk.js'

/** Every rule of the plugin, by name (without the `botmesh/` prefix). */
export const rules: Record<string, Rule.RuleModule> = {
  'no-v1-api': noV1Api,
  'no-await-runtime-enter': noAwaitRuntimeEnter,
  'no-async-plugin-install': noAsyncPluginInstall,
  'no-empty-trigger': noEmptyTrigger,
  'require-timeout-on-ask': requireTimeoutOnAsk,
  'prefer-ctx-user-over-global-state': preferCtxUser,
}

/** Plugin namespace used in rule ids (`botmesh/<rule>`). */
export const PLUGIN_NAMESPACE = 'botmesh'

/** The plugin's flat configs (a type alias, so it fits ESLint's `Record<string, Config>`). */
export type BotMeshConfigs = {
  /** Problems as errors, style/robustness rules as warnings. */
  recommended: Linter.Config
  /** Every rule as an error; `require-timeout-on-ask` also checks waitText/waitMedia/choose/waitAny. */
  strict: Linter.Config
}

/** The plugin object (`meta`, `rules`, `configs`) — the default export. */
export interface BotMeshPlugin extends ESLint.Plugin {
  meta: { name: string; version: string; namespace: string }
  rules: Record<string, Rule.RuleModule>
  configs: BotMeshConfigs
}

/** Name and version of this package, read from its own `package.json` (shipped in the tarball). */
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string }

const plugin = {
  meta: { name: PACKAGE.name, version: PACKAGE.version, namespace: PLUGIN_NAMESPACE },
  rules,
  configs: {} as BotMeshConfigs,
} satisfies BotMeshPlugin

plugin.configs.recommended = {
  name: 'botmesh/recommended',
  plugins: { [PLUGIN_NAMESPACE]: plugin },
  rules: {
    'botmesh/no-v1-api': 'error',
    'botmesh/no-await-runtime-enter': 'error',
    'botmesh/no-async-plugin-install': 'error',
    'botmesh/no-empty-trigger': 'error',
    'botmesh/require-timeout-on-ask': 'warn',
    'botmesh/prefer-ctx-user-over-global-state': 'warn',
  },
}

plugin.configs.strict = {
  name: 'botmesh/strict',
  plugins: { [PLUGIN_NAMESPACE]: plugin },
  rules: {
    'botmesh/no-v1-api': 'error',
    'botmesh/no-await-runtime-enter': 'error',
    'botmesh/no-async-plugin-install': 'error',
    'botmesh/no-empty-trigger': 'error',
    'botmesh/require-timeout-on-ask': [
      'error',
      { methods: ['ask', 'waitText', 'waitMedia', 'waitLocation', 'choose', 'waitAny', 'form'] },
    ],
    'botmesh/prefer-ctx-user-over-global-state': 'error',
  },
}

export const configs: BotMeshConfigs = plugin.configs

const botmesh: BotMeshPlugin = plugin
export default botmesh

/** @deprecated Renamed to {@link BotMeshConfigs}. */
export type BotWaConfigs = BotMeshConfigs
/** @deprecated Renamed to {@link BotMeshPlugin}. */
export type BotWaPlugin = BotMeshPlugin
