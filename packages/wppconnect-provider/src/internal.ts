/**
 * @botmesh/wppconnect/internal — building blocks of the WPPConnect transport:
 * the webhook parser (WA-JS ids, LID discovery) and the outbound mapper. No
 * semver guarantee: these follow wppconnect-server's wire format and can change
 * in any release. Applications use the main entry.
 */

export { parseWebhook, parseMessage, serializedId, jidOf, remoteOfMessageId, lidsIn } from './parseInbound.js'
export type { ParseContext } from './parseInbound.js'
export { toOutbound, target, numberedMenu } from './toOutbound.js'
export type { WppOutbound } from './toOutbound.js'
export type { WppMediaToken } from './types.js'
