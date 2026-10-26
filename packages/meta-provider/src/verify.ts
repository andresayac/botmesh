/**
 * Deprecated re-exports of the Meta webhook verification helpers, which live in
 * `@botmesh/graph-core` (shared by WhatsApp Cloud, Messenger and Instagram).
 */
import { verifyChallenge as graphVerifyChallenge, verifySignature as graphVerifySignature } from '@botmesh/graph-core'

/**
 * @deprecated Use `provider.verifyChallenge(query)` for the subscription handshake, or
 * `verifyChallenge` from `@botmesh/graph-core`. Removal from this package planned for v3.
 */
export const verifyChallenge: typeof graphVerifyChallenge = graphVerifyChallenge

/**
 * @deprecated `provider.ingest(body, headers)` already checks `X-Hub-Signature-256`
 * when `appSecret` is set; for a manual check use `verifySignature` from
 * `@botmesh/graph-core`. Removal from this package planned for v3.
 */
export const verifySignature: typeof graphVerifySignature = graphVerifySignature
