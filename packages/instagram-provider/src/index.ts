/**
 * @botmesh/instagram — Instagram DM (Messenger API for Instagram) transport for
 * @botmesh/core. Webhook-based: DMs arrive on the 'page' webhook object of the
 * connected Facebook Page; sending goes through the Graph Send API.
 *
 * The Graph client and the wire helpers (`GraphClient`, `parseInbound`, `toOutbound`) are in
 * `@botmesh/instagram/internal` (no semver). Webhook signature helpers live in
 * `@botmesh/graph-core`; applications use `provider.verifyChallenge()` and `provider.ingest()`.
 */

export { InstagramProvider } from './InstagramProvider.js'
export { toInstagramError } from './graphClient.js'
export type {
  IgWebhookBody,
  IgEntry,
  IgMessagingEvent,
  IgMessage,
  IgAttachment,
  IgAttachmentPayload,
  IgReaction,
  IgPostback,
} from './parseInbound.js'
export type { ChallengeQuery } from '@botmesh/graph-core'
export type { InstagramProviderConfig, InstagramSendResponse } from './types.js'
