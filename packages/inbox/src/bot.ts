/**
 * attachInbox — keeps an {@link Inbox} in sync with a running `Bot`: every inbound
 * message (`bot.on('message')`) and every accepted send (`after('send')`) is projected
 * into its conversation. Projection failures go to the bot's `'error'` event and never
 * block the bot. Installed as a plugin, so detaching unregisters the hook and the
 * listener.
 */

import type { Bot, ChatId, MessageContext, PluginSpec } from '@botmesh/core'
import type { Inbox } from './inbox.js'

export interface AttachInboxOptions {
  /**
   * Tenant the conversations belong to. Default: the bot's own tenant (`BotConfig.tenantId`,
   * itself `'local'` when unset), so a bot of tenant `'acme'` never files them elsewhere.
   */
  tenantId?: string
}

/** The plugin behind {@link attachInbox}. */
export function inboxProjectionPlugin(inbox: Inbox, options: AttachInboxOptions = {}): PluginSpec {
  return {
    name: 'inbox-projection',
    version: '0.1.0',
    install(ctx) {
      const bot = ctx.bot
      const tenantId = options.tenantId ?? botTenant(bot)
      // Same contract as the core's own errors: the `'error'` event payload is `{ error }`, and
      // with nobody listening it is logged instead (an unheard `'error'` emit would throw and
      // turn a backend blip into an unhandled rejection).
      const report = (error: unknown) => {
        if (bot.listenerCount('error') > 0) bot.emit('error', { error })
        else bot.logger.error({ err: error }, 'inbox projection failed')
      }
      const onMessage = (msg: MessageContext): void => {
        inbox
          .projectMessage({ ref: msg.ref, chatId: msg.from, timestamp: Date.now(), type: msg.type, tenantId, direction: 'inbound' })
          .then(() => undefined, report)
      }
      bot.on('message', onMessage)
      ctx.onDispose(() => { bot.off('message', onMessage) })
      // `after` hooks receive only the payload (no `next`) and run once the provider accepted
      // the send. The projection is not awaited, so a slow inbox never delays the send.
      bot.after('send', (payload: { chatId: ChatId }) => {
        inbox
          .projectMessage({ ref: { id: '', chatId: payload.chatId }, chatId: payload.chatId, timestamp: Date.now(), type: 'text', tenantId, direction: 'outbound' })
          .then(() => undefined, report)
      })
    },
  }
}

/**
 * Project the bot's traffic into `inbox`. Returns the detach function.
 *
 * @example
 * ```ts
 * const inbox = new Inbox(new KvInboxStore(store.durability().kv))
 * const detach = attachInbox(bot, inbox, { tenantId: 'acme' })
 * ```
 */
export function attachInbox(bot: Bot, inbox: Inbox, options: AttachInboxOptions = {}): () => void {
  return bot.plug(inboxProjectionPlugin(inbox, options))
}

/** The bot's tenant: its store is namespaced by `BotConfig.tenantId` (`'local'` when unset). */
function botTenant(bot: Bot): string {
  const namespace = (bot.getStore() as { namespace?: { tenantId?: unknown } }).namespace
  return typeof namespace?.tenantId === 'string' && namespace.tenantId !== '' ? namespace.tenantId : 'local'
}
