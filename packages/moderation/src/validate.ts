/**
 * Config validation for {@link moderationPlugin} and {@link Moderator}. A typo in an
 * action name or a non-numeric window used to surface only on the first violation (as a
 * dispatch error that dropped the message) or to silently disable a rule; every check
 * here throws at construction time with the path of the offending field.
 */

import type { ModerationConfig, ModerationRules } from './types.js'

const ACTIONS = new Set(['warn', 'mute', 'kick', 'delete'])

function show(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return 'an array'
  if (value instanceof RegExp) return String(value)
  return typeof value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(path: string, expected: string, value: unknown, Kind: typeof TypeError | typeof RangeError = TypeError): never {
  throw new Kind(`moderation: ${path} must be ${expected}, got ${show(value)}`)
}

/** Positive number (Infinity allowed when `infinite`). */
function positive(path: string, value: unknown, { integer = false, infinite = false } = {}): void {
  if (typeof value !== 'number') fail(path, integer ? 'a positive integer' : 'a positive number', value)
  const ok = value > 0 && (infinite ? !Number.isNaN(value) : Number.isFinite(value)) && (!integer || Number.isInteger(value))
  if (!ok) fail(path, integer ? 'a positive integer' : 'a positive number', value, RangeError)
}

function actionSpec(path: string, value: unknown): void {
  if (value === undefined) return
  const list = Array.isArray(value) ? value : [value]
  for (const action of list) {
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      fail(path, "'warn', 'mute', 'kick' or 'delete' (or an array of them)", action)
    }
  }
}

function stringList(path: string, value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) fail(path, 'an array of strings', value)
  value.forEach((item, i) => { if (typeof item !== 'string') fail(`${path}[${i}]`, 'a string', item) })
}

function oneOf(path: string, value: unknown, allowed: readonly string[]): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !allowed.includes(value)) fail(path, allowed.map((a) => `'${a}'`).join(' or '), value)
}

/** Validate one rule set (the global rules or a group override). `prefix` is `''` or `groups["id"].`. */
export function validateRules(rules: ModerationRules, prefix = ''): void {
  const p = (field: string) => `${prefix}${field}`
  const { antiSpam, wordFilter, linkFilter, warnings, messages } = rules

  if (antiSpam !== undefined && antiSpam !== false) {
    if (!isObject(antiSpam)) fail(p('antiSpam'), 'an object or false', antiSpam)
    positive(p('antiSpam.maxMessages'), antiSpam.maxMessages, { integer: true })
    positive(p('antiSpam.windowMs'), antiSpam.windowMs)
    actionSpec(p('antiSpam.action'), antiSpam.action)
  }

  if (wordFilter !== undefined && wordFilter !== false) {
    if (!isObject(wordFilter)) fail(p('wordFilter'), 'an object or false', wordFilter)
    if (!Array.isArray(wordFilter.banned)) fail(p('wordFilter.banned'), 'an array of strings and RegExps', wordFilter.banned)
    wordFilter.banned.forEach((term, i) => {
      if (typeof term !== 'string' && !(term instanceof RegExp)) fail(p(`wordFilter.banned[${i}]`), 'a string or a RegExp', term)
    })
    actionSpec(p('wordFilter.action'), wordFilter.action)
  }

  if (linkFilter !== undefined && linkFilter !== false) {
    if (!isObject(linkFilter)) fail(p('linkFilter'), 'an object or false', linkFilter)
    actionSpec(p('linkFilter.action'), linkFilter.action)
    stringList(p('linkFilter.allowInvites'), linkFilter.allowInvites)
    stringList(p('linkFilter.allowDomains'), linkFilter.allowDomains)
    if (linkFilter.invitePatterns !== undefined) {
      if (!Array.isArray(linkFilter.invitePatterns)) fail(p('linkFilter.invitePatterns'), 'an array of RegExps', linkFilter.invitePatterns)
      linkFilter.invitePatterns.forEach((re, i) => {
        if (!(re instanceof RegExp)) fail(p(`linkFilter.invitePatterns[${i}]`), 'a RegExp', re)
      })
    }
  }

  if (warnings !== undefined && warnings !== false) {
    if (!isObject(warnings)) fail(p('warnings'), 'an object or false', warnings)
    positive(p('warnings.max'), warnings.max, { integer: true })
    oneOf(p('warnings.then'), warnings.then, ['mute', 'kick'])
  }

  stringList(p('admins'), rules.admins)
  if (rules.muteMs !== undefined) positive(p('muteMs'), rules.muteMs, { infinite: true })

  if (messages !== undefined) {
    if (!isObject(messages)) fail(p('messages'), 'an object', messages)
    if (messages.warn !== undefined && typeof messages.warn !== 'string') fail(p('messages.warn'), 'a string', messages.warn)
    if (messages.reasons !== undefined) {
      if (!isObject(messages.reasons)) fail(p('messages.reasons'), 'an object', messages.reasons)
      for (const [rule, text] of Object.entries(messages.reasons)) {
        if (text !== undefined && typeof text !== 'string') fail(p(`messages.reasons.${rule}`), 'a string', text)
      }
    }
  }
}

/** Validate a group override (`groups[chatId]` or `setGroupRules`). */
export function validateGroupRules(chatId: string, rules: unknown): void {
  const prefix = `groups[${JSON.stringify(chatId)}]`
  if (rules === false) return
  if (!isObject(rules)) fail(prefix, 'a rule object or false', rules)
  validateRules(rules as ModerationRules, `${prefix}.`)
}

/** Validate the whole plugin config. Throws a `TypeError`/`RangeError` naming the field. */
export function validateConfig(config: ModerationConfig): void {
  if (!isObject(config)) fail('config', 'an object', config)
  validateRules(config)
  oneOf('applyTo', config.applyTo, ['groups', 'all'])
  oneOf('kickFallback', config.kickFallback, ['mute', 'none'])
  if (config.adminCacheMs !== undefined) {
    if (typeof config.adminCacheMs !== 'number' || !(config.adminCacheMs >= 0)) {
      fail('adminCacheMs', 'a number >= 0', config.adminCacheMs, typeof config.adminCacheMs === 'number' ? RangeError : TypeError)
    }
  }
  if (config.maxTrackedUsers !== undefined) positive('maxTrackedUsers', config.maxTrackedUsers, { integer: true })
  if (config.priority !== undefined && (typeof config.priority !== 'number' || !Number.isFinite(config.priority))) {
    fail('priority', 'a finite number', config.priority)
  }
  for (const fn of ['isAdmin', 'onViolation', 'now'] as const) {
    if (config[fn] !== undefined && typeof config[fn] !== 'function') fail(fn, 'a function', config[fn])
  }
  if (config.groups !== undefined) {
    if (!isObject(config.groups)) fail('groups', 'an object keyed by chat id', config.groups)
    for (const [chatId, rules] of Object.entries(config.groups)) validateGroupRules(chatId, rules)
  }
}
