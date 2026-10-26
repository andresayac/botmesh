/**
 * @botmesh/email — email transport (IMAP IDLE inbound + SMTP outbound) for @botmesh/core.
 *
 * The main entry is covered by semver. The MIME parser, address, loop, bounce and
 * quoted-reply helpers live in `@botmesh/email/internal` (no semver).
 */

export { EmailProvider } from './EmailProvider.js'
export type { EmailIngestResult, EmailSkipReason } from './EmailProvider.js'
export type {
  EmailLoopProtectionOptions,
  EmailMediaToken,
  EmailProviderConfig,
  EmailRaw,
  ImapClientLike,
  ImapConnectionOptions,
  ImapFetchedMessage,
  ImapMailboxLock,
  SmtpAttachment,
  SmtpConnectionOptions,
  SmtpMailOptions,
  SmtpSendInfo,
  SmtpTransportLike,
} from './types.js'
export type { EmailAddress } from './address.js'
export type { AutomatedReason, FloodGuardOptions } from './loop.js'
export { toEmailError, toEmailProviderError } from './errors.js'
export { cursorThreadStore, MemoryThreadStore } from './threading.js'
export type { EmailMailboxCursor, EmailThreadingMode, EmailThreadState, EmailThreadStore, MemoryThreadStoreOptions } from './threading.js'
