/**
 * @botmesh/gupshup/internal — building blocks of the Gupshup provider, exported for
 * tests, simulators and custom transports. NOT covered by semver: names and shapes
 * here may change in any release. Applications import from `@botmesh/gupshup`.
 */

export { parseInbound } from './parseInbound.js'
export { toOutbound, mediaUrlOf } from './toOutbound.js'
export type { GupshupOutbound, GupshupOutboundOptions } from './toOutbound.js'
export type { GupshupSendResponse } from './types.js'
