/**
 * @botmesh/evolution — Evolution API v2 transport for @botmesh/core.
 * REST outbound (apikey) + authenticated webhook ingest, LID/PN identity
 * reconciliation, media download, typed errors.
 *
 * This entry is covered by semver (the webhook wire types are `@experimental`).
 * The webhook parser, the outbound mapper and the JWT helpers live in
 * `@botmesh/evolution/internal`, which has no semver guarantee.
 */

export { EvolutionProvider, toEvolutionError } from './EvolutionProvider.js'
export type { HeaderBag } from './webhookAuth.js'
export type { IdentityPersistence, RestHttpOptions } from '@botmesh/wa-gateway-kit'
export type {
  EvolutionProviderConfig,
  EvolutionWebhook,
  EvolutionMessage,
  EvolutionMessageKey,
  EvolutionContextInfo,
} from './types.js'
