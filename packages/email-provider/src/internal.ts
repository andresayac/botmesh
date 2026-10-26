/**
 * @botmesh/email/internal — building blocks of the email provider (MIME parsing,
 * address lists, HTML to text, quoted-reply stripping, loop and bounce detection,
 * subject threading), exported for tests and custom inbound pipelines. NOT covered
 * by semver: names and shapes here may change in any release. Applications import
 * from `@botmesh/email`.
 */

export { normalizeAddress, parseAddressList } from './address.js'
export { parseEmail, decodeEncodedWords } from './mime.js'
export type { ParsedEmail, ParsedAttachment, MimePart, HeaderMap } from './mime.js'
export { htmlToText } from './html.js'
export { stripQuotedReply } from './reply.js'
export { detectAutomated, SenderFloodGuard } from './loop.js'
export { detectBounce } from './bounce.js'
export type { BounceInfo, BounceRecipient } from './bounce.js'
export { baseSubject } from './threading.js'
