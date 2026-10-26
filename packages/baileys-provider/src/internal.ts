/**
 * `@botmesh/baileys/internal` — the provider's building blocks for advanced and self-hosted
 * tooling: JID helpers, the LID/PN identity store, the inbound/outbound mappers, media
 * processing, reconnect classification, session-path checks, the logger adapter and typed
 * handles on the native socket and auth state.
 *
 * **No semver guarantee.** These names follow the pinned Baileys release candidate and the
 * provider's implementation; they may change in any release. Several signatures here use
 * Baileys' own types (`WAMessage`, `AnyMessageContent`, the socket), which the main entry
 * never exposes. An application normally needs only `BaileysProvider`, `toJid` and
 * `isEditedMessage` from `@botmesh/baileys`.
 */

import type makeWASocket from '@whiskeysockets/baileys'
import type { useMultiFileAuthState } from '@whiskeysockets/baileys'
import type { BaileysProvider } from './BaileysProvider.js'

/** The Baileys socket type of the installed release. */
export type BaileysSocketHandle = ReturnType<typeof makeWASocket>
/** The multi-file auth state type of the installed release. */
export type BaileysAuthStateHandle = Awaited<ReturnType<typeof useMultiFileAuthState>>

/**
 * `provider.socket` typed as the Baileys socket (`null` before `start()` and after `stop()`).
 * Calls on it bypass the provider's rate limiter and error mapping.
 */
export function socketOf(provider: BaileysProvider): BaileysSocketHandle | null {
  return provider.socket as BaileysSocketHandle | null
}

/** `provider.auth` typed as Baileys' multi-file auth state. Throws before `start()`. */
export function authStateOf(provider: BaileysProvider): BaileysAuthStateHandle {
  return provider.auth as BaileysAuthStateHandle
}

// Identity + JID helpers (WhatsApp-specific)
export { IdentityStore, canonicalKey } from './identity.js'
export type { IdentityKey } from './identity.js'
export {
  toJid, sanitizeNumber, normalize as normalizeJid, parseJid, buildJid, shortJid,
  isGroup, isBroadcast, isStatus, isNewsletter, isPn, isLid, sameUser,
  toUserId, toChatId, isValidJid, isPnUser, isLidUser, normalizeInboundKey,
} from './jid.js'
export type { JID, JidInput } from './jid.js'

// Mappers (Baileys-typed)
export { toInbound, editedMessageOf, isSystemMessage } from './toInbound.js'
export { isEditedMessage } from './edits.js'
export { toOutbound } from './toOutbound.js'
export { toCallEvent } from './toCallEvent.js'
export { mapSendError } from './BaileysProvider.js'

// Media processing (sticker/opus/upload)
export {
  toMediaUpload, toBuffer as mediaToBuffer, makeSticker, transcodeToOpus, resolveRemoteMedia, REMOTE_MEDIA_MAX_BYTES,
} from './MediaProcessor.js'
export type { StickerOptions, WAMediaUpload } from './MediaProcessor.js'
export { resolveFfmpeg, resolveFfmpegPath, FfmpegNotFoundError } from './ffmpeg.js'
export type { FfmpegResolution, FfmpegStaticLoader } from './ffmpeg.js'

// Reconnect classification
export { classifyDisconnect, backoffDelay, MAX_RECONNECT_ATTEMPTS } from './reconnect.js'
export type { DisconnectAction } from './reconnect.js'

// Session path validation
export { assertSessionDirectorySafe, removeSessionDirectory, resolveSessionDirectory } from './sessionPath.js'

// Logger adapter handed to Baileys
export { toBaileysLogger, isBaileysLogger } from './logger.js'
export type { BaileysLogger } from './logger.js'
