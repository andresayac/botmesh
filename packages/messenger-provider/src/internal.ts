/**
 * `@botmesh/messenger/internal` — the wire helpers of the Messenger transport.
 *
 * `parseInbound` (webhook body → normalized events, stateless) and `toOutbound` /
 * `toOutboundMessages` (normalized content → Send API `message` objects). They are exported
 * for tooling and for the monorepo's own tests. **No semver guarantee:** any of them may
 * change or disappear in a minor release. Applications feed webhooks to
 * `MessengerProvider.ingest()` and send through the bot.
 *
 * @example
 * ```ts
 * import { parseInbound, toOutbound } from '@botmesh/messenger/internal'
 * ```
 */

export { parseInbound } from './parseInbound.js'
export { toOutbound, toOutboundMessages } from './toOutbound.js'
