/**
 * Edit detection for apps: tells a delivered text edit apart from a new message. Its own
 * module so the main entry's declarations never reach the Baileys-typed mappers.
 */

import type { WAMessage } from '@whiskeysockets/baileys'
import { editedMessageOf } from './toInbound.js'

/**
 * Whether `message` (emitted by this provider) is an edit of an earlier message. An edit
 * keeps the original `ref.id`, so `ctx.reply`/`ctx.react` target the edited message; its
 * `body` is the new text and `raw` is the edit stanza.
 *
 * @example
 * ```ts
 * bot.on('message', (m) => { if (isEditedMessage(m)) audit.log('edited', m.ref.id) })
 * ```
 */
export function isEditedMessage(message: { raw?: unknown }): boolean {
  const raw = message.raw
  return typeof raw === 'object' && raw !== null && editedMessageOf(raw as WAMessage) !== undefined
}
