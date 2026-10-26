/**
 * @botmesh/chatwoot — Chatwoot inbox sync + human handoff for `@botmesh/core`.
 *
 * - {@link chatwootPlugin} — the plugin (also exposes the webhook handler and helpers).
 * - {@link ChatwootClient} — the minimal Application API client it uses (via secureFetch).
 *
 * The chat ↔ conversation mapping, the webhook verifier and the text formatters live in
 * `@botmesh/chatwoot/internal`, without a semver guarantee.
 *
 * @packageDocumentation
 */

import type { ChatwootApi } from './chatwootPlugin.js'

export { chatwootPlugin } from './chatwootPlugin.js'
export type {
  ChatwootPluginConfig,
  ChatwootPlugin,
  ChatwootApi,
  ChatwootContactInfo,
  ChatwootWebhookRequest,
  ChatwootWebhookResponse,
} from './chatwootPlugin.js'
export { ChatwootClient, ChatwootApiError } from './client.js'
export type {
  ChatwootClientOptions,
  ChatwootHttpOptions,
  ChatwootMessageType,
  ChatwootConversationStatus,
  ChatwootContactInput,
  ChatwootContactRef,
  ChatwootConversationRef,
  ChatwootMessageStatus,
} from './client.js'
export { memoryKeyValue, storeKeyValue } from './mapping.js'
export type { ChatwootKeyValue, ChatwootChatLink } from './mapping.js'
export type { HeaderBag } from './webhookAuth.js'

/** Types `ctx.tools.chatwoot` once this package is imported. */
declare module '@botmesh/core' {
  interface DefaultTools {
    /** Present when `chatwootPlugin` is plugged into the Bot. */
    chatwoot?: ChatwootApi
  }
}
