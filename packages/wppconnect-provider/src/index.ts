/**
 * @botmesh/wppconnect — wppconnect-server (WA-JS REST gateway) transport for
 * @botmesh/core. REST outbound (Bearer token) + token-checked webhook ingest,
 * LID/PN identity reconciliation, media download, typed errors.
 *
 * This entry is covered by semver (the WA-JS wire types are `@experimental`).
 * The webhook parser and the outbound mapper live in
 * `@botmesh/wppconnect/internal`, which has no semver guarantee.
 */

export { WPPConnectProvider, toWppError } from './WPPConnectProvider.js'
export type { HeaderBag } from './webhookAuth.js'
export type { IdentityPersistence, RestHttpOptions } from '@botmesh/wa-gateway-kit'
export type { WPPConnectProviderConfig, WppMessage, WppSender, WppId } from './types.js'
