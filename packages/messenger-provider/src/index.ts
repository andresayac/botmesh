/**
 * @botmesh/messenger — Facebook Messenger (Meta Graph Send API) transport for
 * @botmesh/core. Webhook-based, postback buttons, generic-template lists,
 * typing indicators and read receipts.
 *
 * The wire helpers (`parseInbound`, `toOutbound`, `toOutboundMessages`) are in
 * `@botmesh/messenger/internal` (no semver). Webhook signature helpers live in
 * `@botmesh/graph-core`; applications use `provider.verifyChallenge()` and `provider.ingest()`.
 */

export { MessengerProvider, toMessengerError } from './MessengerProvider.js'
export type { PageWebhookBody, MessagingEvent, MessengerMessage, MessengerAttachment } from './parseInbound.js'
export type { ChallengeQuery } from '@botmesh/graph-core'
export type { MessengerProviderConfig, MessengerSendResponse } from './types.js'
