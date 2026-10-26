/**
 * `@botmesh/instagram/internal` — the Graph client and wire helpers of the Instagram transport.
 *
 * `GraphClient` (the Send API / sender-action / media-download wrapper the provider uses),
 * `parseInbound` (webhook body → normalized events, stateless) and `toOutbound` (normalized
 * content → Send API `message` object). They are exported for tooling and for the monorepo's
 * own tests. **No semver guarantee:** any of them may change or disappear in a minor release.
 * Applications feed webhooks to `InstagramProvider.ingest()` and send through the bot.
 *
 * @example
 * ```ts
 * import { parseInbound, toOutbound } from '@botmesh/instagram/internal'
 * ```
 */

export { GraphClient } from './graphClient.js'
export type { GraphClientConfig } from './graphClient.js'
export { parseInbound } from './parseInbound.js'
export { toOutbound } from './toOutbound.js'
