/**
 * JID utilities — PN/LID aware for Baileys 7.x.
 *
 * The user should never have to handle PN/LID duality manually; these helpers
 * wrap Baileys' own jid functions with friendly names.
 *
 * @example
 * ```ts
 * import { toJid, isGroup, isPn } from '@botmesh/baileys'
 *
 * const jid = toJid('573001234567')              // '573001234567@s.whatsapp.net'
 * const isGroupChat = isGroup(jid)              // false
 * const isPrivate = isPn(jid)                   // true
 * ```
 */

import {
  jidNormalizedUser,
  jidDecode,
  jidEncode,
  isJidGroup,
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
  isPnUser as baileysIsPnUser,
  isLidUser as baileysIsLidUser,
  areJidsSameUser,
} from '@whiskeysockets/baileys'
/** WhatsApp JID — `number@s.whatsapp.net`, `id@g.us`, `status@broadcast`, `…@lid`. */
export type JID = string
// ChatId/UserId are core's opaque ids (a JID here; UserId in LID or PN form).
// Re-exported, not redeclared, so toChatId/toUserId return the public core types.
import type { ChatId, UserId } from '@botmesh/core'
export type { ChatId, UserId }
/** Anything that can be turned into a JID: full JID, plain number, or `{ groupId, userId }`. */
export type JidInput = string | number | { groupId: string; userId?: string }

export {
  isJidGroup as isGroup,
  isJidBroadcast as isBroadcast,
  isJidStatusBroadcast as isStatus,
  isJidNewsletter as isNewsletter,
  baileysIsPnUser as isPn,
  baileysIsLidUser as isLid,
  areJidsSameUser as sameUser,
}

/**
 * Format a raw phone number/string into a valid JID. A full JID (with `@`) is returned
 * as is; `{ groupId }` is the group's JID. Throws a `TypeError` for input without
 * digits, and for `{ groupId, userId }` (a group participant has no JID of its own:
 * use the group JID for the chat and `toJid(userId)` for the person).
 */
export function toJid(input: JidInput, kind: 'user' | 'group' | 'broadcast' = 'user'): JID {
  if (typeof input === 'object' && input !== null) {
    if (input.userId) {
      throw new TypeError('toJid({ groupId, userId }): a group participant has no JID of its own; use toJid({ groupId }) for the group chat and toJid(userId) for the user')
    }
    return `${groupDigits(input.groupId)}@g.us`
  }
  const raw = String(input)
  if (raw.includes('@')) return raw
  if (kind === 'group') return `${groupDigits(raw)}@g.us`
  const digits = sanitizeNumber(raw)
  if (!digits) throw new TypeError(`toJid: ${JSON.stringify(raw)} has no digits; pass a phone number or a full JID`)
  return kind === 'broadcast' ? `${digits}@broadcast` : `${digits}@s.whatsapp.net`
}

/** Digits of a group id, keeping the hyphen of old-style ids (`<creator>-<timestamp>`). */
function groupDigits(value: string | number): string {
  const id = String(value).replace(/[^\d-]/g, '').replace(/^-+|-+$/g, '')
  if (!/\d/.test(id)) throw new TypeError(`toJid: group id ${JSON.stringify(String(value))} has no digits`)
  return id
}

/** Extract just the digits (no '+', '-', spaces, '@...'). */
export function sanitizeNumber(value: string | number): string {
  return String(value).replace(/[^\d]/g, '')
}

/** Strip device suffix & lowercase — canonical identifier. */
export function normalize(jid: JID): JID {
  return jidNormalizedUser(jid) as JID
}

/** Parse a JID into components. */
export function parseJid(jid: JID): {
  user: string | null
  server: string | null
  device: number | undefined
  domainType: number | undefined
} {
  const d = (jidDecode(jid) ?? {}) as {
    user?: string | null
    server?: string | null
    device?: number
    domainType?: number
  }
  return {
    user: d.user ?? null,
    server: d.server ?? null,
    device: d.device,
    domainType: d.domainType,
  }
}

/** Re-encode components as JID. Accept plain strings for simplicity. */
export function buildJid(user: string, server: string): JID {
  return jidEncode(user, server as any) as JID
}

/** Quick string form for display: hides long LIDs/jids. */
export function shortJid(jid: JID): string {
  const { user, server } = parseJid(jid)
  if (!user || !server) return jid
  const short = user.length > 8 ? user.slice(-8) : user
  return `…${short}@${server}`
}

/** Coerce any input to a `UserId`. */
export function toUserId(input: JidInput): UserId {
  return toJid(input, 'user')
}

/** Coerce any input to a `ChatId` (keeps group/broadcast if present). */
export function toChatId(input: JidInput): ChatId {
  const raw = String(input)
  if (raw.includes('@')) return raw
  return toJid(raw, 'user')
}

/** Validate basic JID shape (cheap, not exhaustive). */
export function isValidJid(value: string): boolean {
  try {
    return Boolean(jidDecode(value))
  } catch {
    return false
  }
}

/* ============================================================================
 * LID/PN IDENTITY (Baileys 7)
 * ============================================================================
 *
 * Baileys 7 migrated WhatsApp's user identity to LIDs (`@lid`) — an opaque,
 * per-account identifier that replaces the phone-number JID (`@s.whatsapp.net`,
 * "PN") as the primary identity. Inbound events still carry the PN twin
 * alongside the LID (`remoteJidAlt`/`participantAlt`), and the wrapper always
 * prefers the PN form for anything user-facing (`ctx.from`, `ctx.sender`).
 * ========================================================================== */

/** True if `jid` is a phone-number-form user JID (`…@s.whatsapp.net`). */
export function isPnUser(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net')
}

/** True if `jid` is a LID-form user JID (`…@lid`) — Baileys 7's opaque identity. */
export function isLidUser(jid: string): boolean {
  return jid.endsWith('@lid')
}

/**
 * Normalize an inbound message key to PN-preferred `chat`/`sender` identifiers.
 *
 * - DM: `chat` prefers `remoteJidAlt` (PN) when `remoteJid` arrived as a LID.
 * - Group: `chat` is always the group JID (`remoteJid`, never a LID); `sender`
 *   prefers `participantAlt` (PN) over the raw `participant` (possibly a LID).
 */
export function normalizeInboundKey(
  key: {
    remoteJid?: string | null
    remoteJidAlt?: string | null
    participant?: string | null
    participantAlt?: string | null
    fromMe?: boolean | null
  },
  isGroup: boolean,
): { chat: string; sender: string } {
  const remote = key.remoteJid ?? ''
  if (isGroup) {
    const sender = (key.participantAlt && isPnUser(key.participantAlt) ? key.participantAlt : key.participant) ?? ''
    return { chat: remote, sender }
  }
  const chat = key.remoteJidAlt && isPnUser(key.remoteJidAlt) && isLidUser(remote) ? key.remoteJidAlt : remote
  return { chat, sender: chat }
}
