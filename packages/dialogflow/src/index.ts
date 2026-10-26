/**
 * @botmesh/dialogflow — Dialogflow ES/CX context for `@botmesh/core`.
 *
 * - {@link dialogflowPlugin} — detectIntent on every
 *   inbound text (before-hook), exposed as `ctx.tools.dialogflow`.
 * - {@link whenDialogflowIntent} — route an intent to a handler or flow via
 *   `bot.when`; flow parameters land in `c.state`.
 * - {@link DialogflowClient} — the REST client (service-account JWT signed with
 *   `node:crypto`, no Google SDK), usable on its own.
 *
 * The result normalizers, the session-id hash and the JWT/credential helpers live in
 * `@botmesh/dialogflow/internal`, without a semver guarantee.
 *
 * @packageDocumentation
 */

import type { DialogflowContext } from './context.js'

export { dialogflowPlugin, dialogflowContext } from './plugin.js'
export type { DialogflowPluginConfig } from './plugin.js'
export { DialogflowContext } from './context.js'
export type { DialogflowContextOptions, SessionSubject } from './context.js'
export { whenDialogflowIntent, withDialogflowState } from './whenDialogflowIntent.js'
export type { DialogflowIntentHandler, IntentTarget, WhenDialogflowIntentOptions } from './whenDialogflowIntent.js'
export { DialogflowClient } from './client.js'
export type { DetectIntentOptions, DialogflowClientConfig, DialogflowCxAgent, DialogflowResult } from './client.js'
export { DialogflowError, ServiceAccountTokenSource } from './auth.js'
export type { AccessTokenSource, HttpOptions, ServiceAccountCredentials } from './auth.js'

/**
 * Augment `@botmesh/core` so `ctx.tools.dialogflow` is typed once the plugin is installed.
 */
declare module '@botmesh/core' {
  interface DefaultTools {
    /** Present when `dialogflowPlugin` is plugged into the Bot. */
    dialogflow?: DialogflowContext
  }
}
