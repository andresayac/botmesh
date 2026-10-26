/**
 * @botmesh/gohighlevel/internal — building blocks of the HighLevel provider, exported
 * for tests, simulators and custom transports. NOT covered by semver: names and shapes
 * here may change in any release. Applications import from `@botmesh/gohighlevel`.
 */

export { parseInbound, channelOf, attachmentKind } from './parseInbound.js'
export type { ParsedGhl } from './parseInbound.js'
export { toOutbound, mediaUrlOf } from './toOutbound.js'
export type { GhlOutboundFields } from './toOutbound.js'
export type { GhlSendResponse } from './types.js'
