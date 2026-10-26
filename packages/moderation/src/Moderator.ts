/**
 * Moderator — the rule engine behind {@link moderationPlugin}. Holds the
 * per-chat state (rate windows, warnings, mutes, admin cache) and runs the
 * actions. Transport-agnostic: chat and user ids are opaque keys, links are
 * detected in the message TEXT, and every provider capability is optional.
 */

import type { ChatId, MessageContext, UserId } from '@botmesh/core'
import { allowedInviteCodes, findInviteLinks, findLinks, hostMatches, isAllowedInviteLink, linkHost, linkScanText } from './links.js'
import { RateWindow } from './rateWindow.js'
import { validateConfig, validateGroupRules } from './validate.js'
import { compileTerms, firstMatch, type CompiledTerm } from './words.js'
import type {
  ActionResult,
  ActionSpec,
  LinkFilterRule,
  ModerationAction,
  ModerationConfig,
  ModerationController,
  ModerationReport,
  ModerationRule,
  ModerationRules,
  WarningPolicy,
} from './types.js'

/** Minimal logger surface (pino-compatible). */
export interface ModeratorLogger {
  warn(obj: unknown, msg?: string): void
  info?(obj: unknown, msg?: string): void
}

/** Sends the warning text; the plugin wires it to `bot.send` with a mention. */
export type WarnSender = (ctx: MessageContext, text: string) => Promise<unknown>

/** Verdict for one inbound message. */
export type Verdict =
  | { kind: 'allow' }
  | { kind: 'ignore'; reason: 'muted' }
  | { kind: 'violation'; report: ModerationReport }

/** Default `'mute'` duration: 10 minutes. */
export const DEFAULT_MUTE_MS = 10 * 60_000
/** Default TTL of a provider admin list: 5 minutes. */
export const DEFAULT_ADMIN_CACHE_MS = 5 * 60_000
/** Default cap of users with a warning counter (see `ModerationConfig.maxTrackedUsers`). */
export const DEFAULT_MAX_TRACKED_USERS = 10_000
/** Mutes and admin lists are swept for expired entries once their map passes this size. */
const SWEEP_FLOOR = 10_000
/** After `getAdmins` fails, wait this long (at most the cache TTL) before asking again. */
const ADMIN_RETRY_MS = 30_000
/** Longest display name put into a warning (in code points). */
const MAX_NAME_LENGTH = 64
/** Bidi controls and invisible separators a display name could use to garble the warning. */
const NAME_INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/**
 * A sender's display name is user input: drop control/bidi characters, collapse
 * whitespace (no line breaks in the warning) and cap the length.
 */
function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const clean = raw
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(NAME_INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return fallback
  const chars = Array.from(clean)
  return chars.length > MAX_NAME_LENGTH ? `${chars.slice(0, MAX_NAME_LENGTH).join('').trimEnd()}…` : clean
}
const DEFAULT_WARNINGS: WarningPolicy = { max: 3, then: 'kick' }

/** Built-in user-visible texts, picked by the chat language (`ctx.lang`, then the bot's default; English otherwise). */
interface DefaultTexts { warn: string; reasons: Record<ModerationRule, string>; anonymous: string }
const DEFAULT_TEXTS: Readonly<Record<'en' | 'es', DefaultTexts>> = {
  en: {
    warn: '⚠️ {name}: {reason}. Warning {count}/{max}.',
    reasons: {
      antiSpam: 'please do not send so many messages in a row',
      wordFilter: 'that language is not allowed',
      linkFilter: 'links to other groups are not allowed',
    },
    anonymous: 'user',
  },
  es: {
    warn: '⚠️ {name}: {reason}. Advertencia {count}/{max}.',
    reasons: {
      antiSpam: 'no envíes tantos mensajes seguidos',
      wordFilter: 'ese lenguaje no está permitido',
      linkFilter: 'no se permiten enlaces de otros grupos',
    },
    anonymous: 'usuario',
  },
}

function defaultTexts(ctx: MessageContext): DefaultTexts {
  for (const lang of [ctx.lang, ctx.defaultLang]) {
    const base = (lang ?? '').toLowerCase().split(/[-_]/)[0]
    if (base === 'es' || base === 'en') return DEFAULT_TEXTS[base]
  }
  return DEFAULT_TEXTS.en
}

interface Resolved {
  rules: ModerationRules
  words: CompiledTerm[]
}

type InternalResult = ActionResult & { escalate?: ModerationAction }

const SEP = '\u0000'
const keyOf = (chatId: ChatId, userId: UserId) => `${chatId}${SEP}${userId}`

function actionsOf(spec: ActionSpec | undefined, fallback: readonly ModerationAction[]): ModerationAction[] {
  if (spec === undefined) return [...fallback]
  return typeof spec === 'string' ? [spec] : [...spec]
}

export class Moderator implements ModerationController {
  private readonly windows = new RateWindow()
  private readonly warnCounts = new Map<string, number>()
  private readonly mutes = new Map<string, number>()
  private readonly adminCache = new Map<ChatId, { at: number; admins: Set<UserId> }>()
  private readonly groupOverrides = new Map<ChatId, ModerationRules | false>()
  /** Resolutions of chats WITH an override (bounded by the overrides). */
  private readonly resolvedCache = new Map<ChatId, Resolved | false>()
  /** The shared resolution of every chat without an override. */
  private baseResolved: Resolved | false | undefined
  private readonly warnedUnsupported = new Set<string>()
  private readonly now: () => number
  private readonly maxTracked: number
  /** Size at which the next sweep of expired mutes / stale admin lists runs (amortized). */
  private muteSweepAt = SWEEP_FLOOR
  private adminSweepAt = SWEEP_FLOOR

  constructor(
    private readonly config: ModerationConfig,
    private readonly logger: ModeratorLogger,
    private readonly sendWarning: WarnSender,
  ) {
    validateConfig(config)
    this.now = config.now ?? Date.now
    this.maxTracked = config.maxTrackedUsers ?? DEFAULT_MAX_TRACKED_USERS
    for (const [chatId, rules] of Object.entries(config.groups ?? {})) this.groupOverrides.set(chatId, rules)
  }

  /* ---------------------------------------------------------------- rules */

  /**
   * Effective rules for a chat (global rules shallow-merged with its override), or `false`.
   * Chats without an override share one resolution, so the cache (and the compiled word
   * filters) grows with the configured overrides, never with the number of chats seen.
   */
  private resolve(chatId: ChatId): Resolved | false {
    const override = this.groupOverrides.get(chatId)
    if (override === undefined) return (this.baseResolved ??= this.build(undefined))
    const cached = this.resolvedCache.get(chatId)
    if (cached !== undefined) return cached
    const resolved = this.build(override)
    this.resolvedCache.set(chatId, resolved)
    return resolved
  }

  private build(override: ModerationRules | false | undefined): Resolved | false {
    if (override === false) return false
    const {
      groups: _groups, provider: _provider, isAdmin: _isAdmin, onViolation: _onViolation, now: _now,
      applyTo: _applyTo, adminCacheMs: _adminCacheMs, kickFallback: _kickFallback, priority: _priority,
      maxTrackedUsers: _maxTrackedUsers,
      ...base
    } = this.config
    const rules: ModerationRules = { ...base, ...(override ?? {}) }
    if (rules.enabled === false) return false
    if (rules.autoKickOnLink && !rules.linkFilter) rules.linkFilter = { action: ['delete', 'kick'] }
    const wf = rules.wordFilter
    return { rules, words: wf ? compileTerms(wf.banned, wf.wholeWord ?? true) : [] }
  }

  setGroupRules(chatId: ChatId, rules: ModerationRules | false | undefined): void {
    if (rules !== undefined) validateGroupRules(chatId, rules)
    if (rules === undefined) this.groupOverrides.delete(chatId)
    else this.groupOverrides.set(chatId, rules)
    this.resolvedCache.delete(chatId)
  }

  /* ---------------------------------------------------------------- state */

  mute(chatId: ChatId, userId: UserId, ms?: number): void {
    if (ms !== undefined && (typeof ms !== 'number' || Number.isNaN(ms) || ms <= 0)) {
      throw new RangeError(`moderation: mute() duration must be a positive number of ms (Infinity mutes until unmute), got ${String(ms)}`)
    }
    const resolved = this.resolve(chatId)
    const duration = ms ?? (resolved ? resolved.rules.muteMs : undefined) ?? this.config.muteMs ?? DEFAULT_MUTE_MS
    const key = keyOf(chatId, userId)
    this.mutes.delete(key)
    this.mutes.set(key, this.now() + duration)
    if (this.mutes.size > this.muteSweepAt) {
      const now = this.now()
      for (const [k, until] of this.mutes) if (until <= now) this.mutes.delete(k)
      this.muteSweepAt = Math.max(SWEEP_FLOOR, this.mutes.size * 2)
    }
  }

  unmute(chatId: ChatId, userId: UserId): boolean {
    return this.mutes.delete(keyOf(chatId, userId))
  }

  isMuted(chatId: ChatId, userId: UserId): boolean {
    const key = keyOf(chatId, userId)
    const until = this.mutes.get(key)
    if (until === undefined) return false
    if (until <= this.now()) {
      this.mutes.delete(key)
      return false
    }
    return true
  }

  warnings(chatId: ChatId, userId: UserId): number {
    return this.warnCounts.get(keyOf(chatId, userId)) ?? 0
  }

  resetWarnings(chatId: ChatId, userId?: UserId): void {
    if (userId !== undefined) {
      this.warnCounts.delete(keyOf(chatId, userId))
      return
    }
    const prefix = `${chatId}${SEP}`
    for (const key of this.warnCounts.keys()) if (key.startsWith(prefix)) this.warnCounts.delete(key)
  }

  invalidateAdmins(chatId?: ChatId): void {
    if (chatId === undefined) this.adminCache.clear()
    else this.adminCache.delete(chatId)
  }

  /** Forget everything about a user in a chat (they left or were removed). */
  forget(chatId: ChatId, userId: UserId): void {
    const key = keyOf(chatId, userId)
    this.windows.reset(key)
    this.warnCounts.delete(key)
    this.mutes.delete(key)
  }

  async kick(chatId: ChatId, userId: UserId): Promise<ActionResult> {
    const groups = this.config.provider?.groups
    if (!groups?.removeParticipants) {
      this.reportUnsupported('kick')
      return { action: 'kick', status: 'unsupported' }
    }
    try {
      await groups.removeParticipants(chatId, [userId])
      this.forget(chatId, userId)
      return { action: 'kick', status: 'done' }
    } catch (error) {
      return { action: 'kick', status: 'failed', error }
    }
  }

  /* ---------------------------------------------------------------- admin */

  private async isAdmin(chatId: ChatId, userId: UserId, rules: ModerationRules): Promise<boolean> {
    if (rules.admins?.includes(userId)) return true
    if (this.config.isAdmin) {
      try {
        if (await this.config.isAdmin(chatId, userId)) return true
      } catch (err) {
        // A failing staff lookup must not drop every group message: treat as non-admin.
        this.logger.warn({ err }, 'moderation: isAdmin threw; treating sender as non-admin')
      }
    }
    const groups = this.config.provider?.groups
    if (!groups?.getAdmins) return false
    const ttl = this.config.adminCacheMs ?? DEFAULT_ADMIN_CACHE_MS
    let entry = this.adminCache.get(chatId)
    if (!entry || this.now() - entry.at > ttl) {
      try {
        const admins = await groups.getAdmins(chatId)
        entry = { at: this.now(), admins: new Set(admins) }
        this.adminCache.delete(chatId)
        this.adminCache.set(chatId, entry)
        if (this.adminCache.size > this.adminSweepAt) {
          const now = this.now()
          for (const [k, e] of this.adminCache) if (now - e.at > ttl) this.adminCache.delete(k)
          this.adminSweepAt = Math.max(SWEEP_FLOOR, this.adminCache.size * 2)
        }
      } catch (err) {
        // Keep the last known list (or none) and retry after a short backoff, instead of
        // calling the provider (and logging) for every message while it is failing.
        const backoff = Math.min(ttl, ADMIN_RETRY_MS)
        this.logger.warn(
          { err, retryInMs: backoff },
          entry
            ? 'moderation: could not fetch group admins; using the last known list'
            : 'moderation: could not fetch group admins; treating senders as non-admins',
        )
        entry = { at: this.now() - ttl + backoff, admins: entry?.admins ?? new Set() }
        this.adminCache.delete(chatId)
        this.adminCache.set(chatId, entry)
      }
    }
    return entry.admins.has(userId)
  }

  /* ---------------------------------------------------------------- check */

  /** Evaluate one inbound message and run the actions of the rule that fired. */
  async check(ctx: MessageContext): Promise<Verdict> {
    if (ctx.interaction || ctx.isFromMe) return { kind: 'allow' }
    if (!ctx.isGroup && (this.config.applyTo ?? 'groups') === 'groups') return { kind: 'allow' }
    const resolved = this.resolve(ctx.from)
    if (!resolved) return { kind: 'allow' }
    const { rules } = resolved
    const chatId = ctx.from
    const userId = ctx.sender
    const bypass = rules.adminBypass ?? true

    if (this.isMuted(chatId, userId)) {
      if (bypass && (await this.isAdmin(chatId, userId, rules))) {
        this.unmute(chatId, userId)
      } else {
        if (rules.deleteWhileMuted) await this.runDelete(ctx)
        return { kind: 'ignore', reason: 'muted' }
      }
    }
    const hit = this.findViolation(ctx, resolved)
    if (!hit) return { kind: 'allow' }
    // Admin lookups (a user callback, a provider call) only for messages that broke a rule.
    if (bypass && (await this.isAdmin(chatId, userId, rules))) return { kind: 'allow' }
    const report = await this.enforce(ctx, rules, hit.rule, hit.detail, hit.actions)
    return { kind: 'violation', report }
  }

  private findViolation(
    ctx: MessageContext,
    { rules, words }: Resolved,
  ): { rule: ModerationRule; detail: string; actions: ModerationAction[] } | undefined {
    const body = ctx.body ?? ''
    if (rules.linkFilter) {
      const link = this.checkLinks(body, rules.linkFilter)
      if (link) return { rule: 'linkFilter', detail: link, actions: actionsOf(rules.linkFilter.action, ['delete', 'warn']) }
    }
    if (rules.wordFilter && words.length > 0) {
      const term = firstMatch(words, body)
      if (term) return { rule: 'wordFilter', detail: term.label, actions: actionsOf(rules.wordFilter.action, ['delete']) }
    }
    const spam = rules.antiSpam
    if (spam && spam.maxMessages > 0 && spam.windowMs > 0) {
      const key = keyOf(ctx.from, ctx.sender)
      const count = this.windows.hit(key, this.now(), spam.windowMs)
      if (count > spam.maxMessages) {
        // One burst → one action: start counting afresh after a violation.
        this.windows.reset(key)
        return { rule: 'antiSpam', detail: `${count} msgs / ${spam.windowMs}ms`, actions: actionsOf(spam.action, ['warn']) }
      }
    }
    return undefined
  }

  private checkLinks(body: string, rule: LinkFilterRule): string | undefined {
    if (!body) return undefined
    body = linkScanText(body)
    const patterns = rule.invitePatterns ?? []
    // Exact code match only: a substring match would let any URL that merely
    // contains an allowed code through.
    const allowed = allowedInviteCodes(rule.allowInvites ?? [], patterns)
    if (rule.groupInvites ?? true) {
      for (const invite of findInviteLinks(body, patterns)) {
        if (!allowed.has(invite.code)) return invite.url
      }
    }
    if (rule.allLinks) {
      const domains = rule.allowDomains ?? []
      for (const link of findLinks(body)) {
        if (isAllowedInviteLink(link, allowed, patterns)) continue
        const host = linkHost(link)
        if (host && domains.some((d) => hostMatches(host, d))) continue
        return link
      }
    }
    return undefined
  }

  /* -------------------------------------------------------------- actions */

  private async enforce(
    ctx: MessageContext,
    rules: ModerationRules,
    rule: ModerationRule,
    detail: string,
    actions: ModerationAction[],
  ): Promise<ModerationReport> {
    const results: ActionResult[] = []
    const queue = [...actions]
    const done = new Set<ModerationAction>()
    while (queue.length > 0) {
      const action = queue.shift()!
      if (done.has(action)) continue
      done.add(action)
      const { escalate, ...result } = await this.runAction(ctx, rules, rule, action)
      results.push(result)
      // Warn escalation: the max-th warning turns into mute/kick.
      if (escalate) queue.push(escalate)
      // Degrade: an unsupported kick becomes a mute so the offender is at least ignored.
      if (
        action === 'kick' && result.status === 'unsupported' &&
        (this.config.kickFallback ?? 'mute') === 'mute' && !done.has('mute')
      ) {
        done.add('mute')
        this.mute(ctx.from, ctx.sender, rules.muteMs)
        results.push({ action: 'mute', status: 'done', fallbackFor: 'kick' })
      }
    }
    return {
      chatId: ctx.from,
      senderId: ctx.sender,
      rule,
      detail,
      ref: ctx.ref,
      results,
      warnings: this.warnings(ctx.from, ctx.sender),
    }
  }

  private async runAction(
    ctx: MessageContext,
    rules: ModerationRules,
    rule: ModerationRule,
    action: ModerationAction,
  ): Promise<InternalResult> {
    switch (action) {
      case 'delete':
        return this.runDelete(ctx)
      case 'mute':
        this.mute(ctx.from, ctx.sender, rules.muteMs)
        return { action, status: 'done' }
      case 'kick':
        return this.kick(ctx.from, ctx.sender)
      case 'warn':
        return this.runWarn(ctx, rules, rule)
    }
  }

  private async runDelete(ctx: MessageContext): Promise<ActionResult> {
    const provider = this.config.provider
    try {
      if (provider) {
        if (!provider.deleteMessage) {
          this.reportUnsupported('delete')
          return { action: 'delete', status: 'unsupported' }
        }
        await provider.deleteMessage(ctx.ref)
        return { action: 'delete', status: 'done' }
      }
      // No provider handle: ctx.delete() degrades to a silent no-op when the
      // transport cannot delete, so support cannot be verified.
      await ctx.delete()
      return { action: 'delete', status: 'attempted' }
    } catch (error) {
      return { action: 'delete', status: 'failed', error }
    }
  }

  /**
   * Count one more warning for `key` and return the new count. The map keeps users in
   * least-to-most recently warned order and drops the least recent past `maxTrackedUsers`.
   */
  private bumpWarning(key: string): number {
    const count = (this.warnCounts.get(key) ?? 0) + 1
    this.warnCounts.delete(key)
    this.warnCounts.set(key, count)
    while (this.warnCounts.size > this.maxTracked) {
      const oldest = this.warnCounts.keys().next().value
      if (oldest === undefined) break
      this.warnCounts.delete(oldest)
    }
    return count
  }

  private async runWarn(ctx: MessageContext, rules: ModerationRules, rule: ModerationRule): Promise<InternalResult> {
    const policy = rules.warnings === undefined ? DEFAULT_WARNINGS : rules.warnings
    const key = keyOf(ctx.from, ctx.sender)
    const count = this.bumpWarning(key)
    const escalate = policy && count >= policy.max ? policy.then : undefined
    if (escalate) this.warnCounts.delete(key)

    const defaults = defaultTexts(ctx)
    const reason = rules.messages?.reasons?.[rule] ?? defaults.reasons[rule]
    // One pass: a display name such as '{reason}' is user input and must stay literal.
    const values: Record<string, string> = {
      name: cleanName(ctx.senderInfo?.displayName ?? ctx.pushName, defaults.anonymous),
      reason,
      count: String(count),
      max: policy ? String(policy.max) : '∞',
    }
    const text = (rules.messages?.warn ?? defaults.warn).replace(/\{(name|reason|count|max)\}/g, (_, key: string) => values[key]!)
    const extra = escalate ? { escalate } : {}
    try {
      await this.sendWarning(ctx, text)
      return { action: 'warn', status: 'done', ...extra }
    } catch (error) {
      return { action: 'warn', status: 'failed', error, ...extra }
    }
  }

  private reportUnsupported(action: ModerationAction): void {
    if (this.warnedUnsupported.has(action)) return
    this.warnedUnsupported.add(action)
    this.logger.warn(
      { action },
      action === 'kick'
        ? 'moderation: provider has no groups.removeParticipants, kick is unsupported (degrading)'
        : 'moderation: provider has no deleteMessage, delete is unsupported',
    )
  }
}
