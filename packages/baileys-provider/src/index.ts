/**
 * @botmesh/baileys — WhatsApp transport for @botmesh/core (Baileys 7, IProvider v2).
 *
 * The main entry holds what an application needs: the provider, its options, `toJid`
 * (phone number → chat id), `isEditedMessage` and the rate limiter. Native Baileys values
 * are typed as opaque aliases (`BaileysNativeMessage`, `BaileysSocket`, `BaileysAuthState`),
 * so no Baileys type is part of this entry's API. The JID helpers, the identity store, the
 * mappers and the other building blocks live in `@botmesh/baileys/internal` (no semver).
 *
 * @example
 * ```ts
 * import { Bot } from '@botmesh/core'
 * import { BaileysProvider } from '@botmesh/baileys'
 *
 * const bot = new Bot({ provider: new BaileysProvider({ session: 'demo', qr: { terminal: true } }) })
 * await bot.start()
 * ```
 */

export { BaileysProvider } from './BaileysProvider.js'
export type { BaileysProviderConfig, QrConfig } from './BaileysProvider.js'
export type { BaileysNativeMessage, BaileysSocket, BaileysAuthState } from './types.js'
export type { BrowserConfig, BrowserPreset } from './browser.js'
export type { PollStore, StoredPoll, PollOption } from './types.js'
export type { RemoteMediaConfig } from './MediaProcessor.js'
export type { ReconnectPolicy } from './reconnect.js'

// Phone number → WhatsApp id, and edit detection
export { toJid } from './jid.js'
export type { JID, JidInput } from './jid.js'
export { isEditedMessage } from './edits.js'

// Anti-ban rate limiter
export { RateLimiter, RateLimiterTimeout } from './RateLimiter.js'
export type { RateLimitConfig, RateLimitBucketConfig, RateLimitJitterConfig } from './RateLimiter.js'

/* -------------------------------------------------------------------------- */
/* Deprecated re-exports: moved to `@botmesh/baileys/internal` (no semver).    */
/* Kept until v3 so alpha code keeps compiling. `toInbound` and `toOutbound`   */
/* are only in `/internal`: their signatures use Baileys' own types.           */
/* -------------------------------------------------------------------------- */

export {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  IdentityStore,
} from './identity.js'
export {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  sanitizeNumber,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  normalize as normalizeJid,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  parseJid,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  buildJid,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  shortJid,
  /** @deprecated Use `ctx.isGroup`, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isGroup,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isBroadcast,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isStatus,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isNewsletter,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isPn,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isLid,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  sameUser,
  /** @deprecated Use `toJid`, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  toUserId,
  /** @deprecated Use `toJid`, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  toChatId,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isValidJid,
} from './jid.js'
export {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  toMediaUpload,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  toBuffer as mediaToBuffer,
  /** @deprecated Send `{ kind: 'sticker' }` content, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  makeSticker,
  /** @deprecated Send `{ kind: 'voice' }` content, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  transcodeToOpus,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  resolveRemoteMedia,
  /** @deprecated Tune the cap with `remoteMedia.maxBytes`, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  REMOTE_MEDIA_MAX_BYTES,
} from './MediaProcessor.js'
export type {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  WAMediaUpload,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  StickerOptions,
} from './MediaProcessor.js'
export {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  classifyDisconnect,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  backoffDelay,
  /** @deprecated Use `reconnect: { maxAttempts }`, or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  MAX_RECONNECT_ATTEMPTS,
} from './reconnect.js'
export type {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  DisconnectAction,
} from './reconnect.js'
export {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  assertSessionDirectorySafe,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  removeSessionDirectory,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  resolveSessionDirectory,
} from './sessionPath.js'
export {
  /** @deprecated Pass any `LoggerLike` as `logger` (the provider adapts it), or import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  toBaileysLogger,
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  isBaileysLogger,
} from './logger.js'
export type {
  /** @deprecated Import from `@botmesh/baileys/internal` (no semver). Removal planned for v3. */
  BaileysLogger,
} from './logger.js'
