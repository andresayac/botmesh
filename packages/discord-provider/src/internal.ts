/**
 * @botmesh/discord/internal — building blocks of the Discord provider, exported for
 * tests, simulators and custom transports. NOT covered by semver: names and shapes
 * here may change in any release. Applications import from `@botmesh/discord`.
 */

export { GatewaySocket, defaultSocketFactory, gatewayConnectUrl } from './gateway.js'
export type { GatewaySocketConfig } from './gateway.js'
export { DiscordRestClient, DEFAULT_REST_TIMEOUT_MS, DEFAULT_UPLOAD_TIMEOUT_MS } from './restClient.js'
export type { DiscordRestClientConfig } from './restClient.js'
export { toOutbound } from './toOutbound.js'
export type { DiscordFile, DiscordOutboundPayload } from './toOutbound.js'
export { parseDispatch, snowflakeTimestamp } from './parseInbound.js'
export type {
  GatewayPayload,
  DiscordUser,
  DiscordAttachment,
  DiscordMessagePayload,
  DiscordInteractionData,
  DiscordInteractionPayload,
  DiscordMessageResponse,
} from './types.js'
export {
  GatewayOpcode,
  InteractionType,
  ComponentType,
  FATAL_CLOSE_CODES,
  FRESH_SESSION_CODES,
} from './types.js'
