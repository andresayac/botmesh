/**
 * `@botmesh/moderation/internal` — the scanners and compilers behind the moderation rules:
 * the link and group-invite finders and the word-filter compiler with its text folding.
 * **No semver guarantee:** any of them may change or disappear in a minor release.
 * Applications use `moderationPlugin` and `Moderator` from `@botmesh/moderation`.
 *
 * @example
 * ```ts
 * import { findInviteLinks } from '@botmesh/moderation/internal'
 * ```
 *
 * @packageDocumentation
 */

export { findInviteLinks, findLinks } from './links.js'
export type { InviteLink } from './links.js'
export { compileTerms, foldText } from './words.js'
export type { CompiledTerm } from './words.js'
