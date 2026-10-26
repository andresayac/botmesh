/**
 * @botmesh/discord — Discord transport for @botmesh/core. Gateway websocket for
 * events, REST for sending; buttons/selects/slash commands as interactions.
 *
 * The main entry is covered by semver. The gateway socket, REST client, wire
 * mappers and Discord payload types live in `@botmesh/discord/internal` (no semver).
 */

export { DiscordProvider, DISCORD_MEDIA_HOSTS } from './DiscordProvider.js'
export { toDiscordError } from './restClient.js'
export { isEditedMessage } from './parseInbound.js'
export type { DiscordProviderConfig, SocketLike, SocketFactory, DiscordApiErrorBody, DiscordAllowedMentions } from './types.js'
export { GatewayIntents, DEFAULT_INTENTS } from './types.js'
