/**
 * @botmesh/evolution/internal — building blocks of the Evolution transport: the
 * webhook parser, the outbound mapper and the HS256 JWT helpers used to check
 * Evolution's `jwt_key` webhooks. No semver guarantee: these follow Evolution's
 * wire format and can change in any release. Applications use the main entry.
 */

export { parseWebhook, parseMessage, normalizeEventName, textOf, unwrapMessage } from './parseInbound.js'
export type { ParseContext } from './parseInbound.js'
export { toOutbound, keyFromRef, numberedMenu } from './toOutbound.js'
export type { EvolutionOutbound } from './toOutbound.js'
export { verifyHs256Jwt, signHs256Jwt } from './webhookAuth.js'
export type { JwtCheck } from './webhookAuth.js'
export type { EvolutionMediaToken } from './types.js'
