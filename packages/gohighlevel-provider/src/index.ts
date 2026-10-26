/**
 * @botmesh/gohighlevel — HighLevel (LeadConnector) Conversations API transport
 * for @botmesh/core: SMS, WhatsApp, Email, FB, IG and Live chat through one
 * CRM contact, with Ed25519-signed (`X-GHL-Signature`) webhooks.
 *
 * The main entry is covered by semver. The wire mappers live in
 * `@botmesh/gohighlevel/internal` (no semver).
 */

export { GoHighLevelProvider } from './GoHighLevelProvider.js'
export { GoHighLevelApiError, toGhlError } from './errors.js'
export { GHL_WEBHOOK_PUBLIC_KEY, verifyGhlSignature } from './signature.js'
export type { GhlSignatureResult, VerifyGhlInput } from './signature.js'
export type { HeaderBag, ProviderHttpOptions } from './http.js'
export type { GoHighLevelProviderConfig, GhlChannel, GhlWebhookBody, GhlErrorBody } from './types.js'
