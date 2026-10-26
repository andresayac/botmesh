/**
 * `@botmesh/chatwoot/internal` — the building blocks of the Chatwoot bridge: the chat ↔
 * contact/conversation mapping over a key/value store, the webhook verifier (token and
 * HMAC) and the text formatters used to mirror messages. **No semver guarantee:** any of
 * them may change or disappear in a minor release. Applications use `chatwootPlugin` (its
 * `handleWebhook` / `webhookHandler` verify every delivery) and `ChatwootClient` from
 * `@botmesh/chatwoot`.
 *
 * @example
 * ```ts
 * import { verifyWebhook } from '@botmesh/chatwoot/internal'
 * ```
 *
 * @packageDocumentation
 */

export { ChatwootMapping } from './mapping.js'
export { verifyWebhook } from './webhookAuth.js'
export type { WebhookAuthConfig } from './webhookAuth.js'
export { inboundText, outboundText } from './format.js'
