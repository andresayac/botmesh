/**
 * @botmesh/wa-gateway-kit — building blocks shared by the WhatsApp REST gateway
 * transports (@botmesh/evolution, @botmesh/wppconnect): the JSON-over-secureFetch
 * REST client, outbound media resolution and LID/PN identity reconciliation.
 *
 * Public and covered by semver: the providers depend on it with a caret range,
 * so every export here is a contract (pinned in tests/entry.test.ts).
 */

export {
  restCall,
  resolveHttpPolicy,
  gatewayBaseUrl,
  parseRetryAfter,
  isRecord,
  describeErrorBody,
} from './rest.js'
export type { RestHttpOptions, RestResponse } from './rest.js'
export { resolveMedia, guessMimetype, toDataUri } from './media.js'
export type { ResolvedMedia } from './media.js'
export { WaIdentityStore, normalizeJid, isLidJid, isGroupJid } from './identity.js'
export type { IdentityPersistence } from './identity.js'
