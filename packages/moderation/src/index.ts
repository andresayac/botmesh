/**
 * @botmesh/moderation — group moderation plugin for `@botmesh/core`.
 *
 * - {@link moderationPlugin} — anti-spam windows, word/regex filters, foreign
 *   invite-link filtering and warn/mute/kick/delete actions, with per-group
 *   config and admin bypass. Provider capabilities (delete, group admin) are
 *   optional: unsupported actions degrade and are reported.
 * - {@link Moderator} — the engine, usable without a Bot.
 *
 * The link scanners and the word-filter compiler live in `@botmesh/moderation/internal`,
 * without a semver guarantee.
 *
 * @packageDocumentation
 */

import type { ModerationController } from './types.js'

export { moderationPlugin } from './plugin.js'
export { Moderator, DEFAULT_MUTE_MS, DEFAULT_ADMIN_CACHE_MS, DEFAULT_MAX_TRACKED_USERS } from './Moderator.js'
export type { ModeratorLogger, WarnSender, Verdict } from './Moderator.js'
export type {
  ActionResult,
  ActionSpec,
  AntiSpamRule,
  GroupAdminApi,
  LinkFilterRule,
  ModerationAction,
  ModerationConfig,
  ModerationController,
  ModerationMessages,
  ModerationProvider,
  ModerationReport,
  ModerationRule,
  ModerationRules,
  WarningPolicy,
  WordFilterRule,
} from './types.js'

/**
 * Augment `@botmesh/core` so `ctx.tools.moderation` is typed once
 * `moderationPlugin` is installed.
 */
declare module '@botmesh/core' {
  interface DefaultTools {
    /** Present when `moderationPlugin` is plugged into the Bot. */
    moderation?: ModerationController
  }
}
