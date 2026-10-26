/**
 * Bot-level errors that are not transport errors: a send attempted while the bot is not
 * running, a provider event that breaks the normalized event contract.
 */

/**
 * A send (`bot.send`, `ctx.reply`, an edit…) was attempted while the bot is not running:
 * before `bot.start()` (or after a failed start), or after `bot.stop()`. Nothing reached
 * the provider. Sends are accepted from the moment the transport starts connecting (so a
 * `'ready'` listener can send) until `stop()` stops the transport.
 */
export class BotNotRunningError extends Error {
  readonly code = 'BOT_NOT_RUNNING'
  /** What was attempted: `'send'`, `'edit'`, `'stream'` or `'delete'`. */
  readonly operation: string
  constructor(operation: string) {
    super(`bot is not running: ${operation} needs bot.start() first (or the bot was stopped)`)
    this.name = 'BotNotRunningError'
    this.operation = operation
  }
}

/**
 * A provider emitted an event that does not follow the normalized event contract
 * (`IProvider.onEvent`): not an object, an unknown `kind`, or a message/interaction without
 * the ids the core routes by. The event is dropped and this error goes to the bot `'error'`
 * event. `reason` names the broken field; no ids or message contents are included.
 */
export class InvalidProviderEventError extends Error {
  readonly code = 'INVALID_PROVIDER_EVENT'
  /** The provider that emitted the event. */
  readonly providerId: string
  /** What is wrong with the event (e.g. `'message.chatId must be a non-empty string'`). */
  readonly reason: string
  constructor(providerId: string, reason: string) {
    super(`provider "${providerId}" emitted an invalid event: ${reason}`)
    this.name = 'InvalidProviderEventError'
    this.providerId = providerId
    this.reason = reason
  }
}
