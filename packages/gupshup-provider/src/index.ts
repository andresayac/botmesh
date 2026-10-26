/**
 * @botmesh/gupshup — Gupshup WhatsApp transport for @botmesh/core: v1 send API
 * (text, media, quick replies, lists, templates) and v2 callbacks
 * authenticated by a shared webhook token.
 *
 * The main entry is covered by semver. The wire mappers live in
 * `@botmesh/gupshup/internal` (no semver).
 */

export { GupshupProvider } from './GupshupProvider.js'
export type { GupshupIngestRequest } from './GupshupProvider.js'
export { GupshupApiError, toGupshupError } from './errors.js'
export { DEFAULT_LIST_BUTTON_TEXT } from './toOutbound.js'
export type { HeaderBag, ProviderHttpOptions } from './http.js'
export type {
  GupshupProviderConfig,
  GupshupCallback,
  GupshupMessagePayload,
  GupshupEventPayload,
  GupshupSender,
} from './types.js'
