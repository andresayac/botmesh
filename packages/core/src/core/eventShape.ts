/**
 * Shape check of the events a provider emits (`IProvider.onEvent`): the minimum the
 * inbound pipeline reads without crashing. A broken event is reported once as an
 * `InvalidProviderEventError` (see `bot/inbound.ts`) instead of surfacing as a generic
 * `TypeError` deep in the pipeline. Ids are only type-checked, never parsed. An event of a
 * kind this core does not know (a newer provider) is not broken: it is ignored, for forward
 * compatibility (see {@link isUnknownEventKind}).
 */

const KNOWN_KINDS = new Set(['message', 'interaction', 'connection', 'status', 'reaction', 'poll-vote', 'group', 'presence', 'call'])

/** A well-formed event whose string `kind` this core does not handle (ignored, not reported). */
export function isUnknownEventKind(event: unknown): boolean {
  return isObject(event) && typeof event.kind === 'string' && !KNOWN_KINDS.has(event.kind)
}

/** Why `event` breaks the normalized event contract, or `undefined` when it is usable. */
export function invalidEventReason(event: unknown): string | undefined {
  if (!isObject(event)) return 'the event is not an object'
  switch (event.kind) {
    case 'message': return messageReason(event.message)
    case 'interaction': return interactionReason(event.interaction)
    case 'connection':
      if (!isObject(event.update)) return 'connection.update must be an object'
      return typeof event.update.state === 'string' ? undefined : 'connection.update.state must be a string'
    case 'status': return isObject(event.status) ? undefined : 'status.status must be an object'
    case 'reaction': return isObject(event.reaction) ? undefined : 'reaction.reaction must be an object'
    case 'poll-vote': return isObject(event.vote) ? undefined : 'poll-vote.vote must be an object'
    case 'group':
    case 'presence':
    case 'call': return isObject(event.event) ? undefined : `${event.kind}.event must be an object`
    // Unknown string kinds are ignored by the caller (isUnknownEventKind), not reported.
    default: return typeof event.kind === 'string' ? undefined : 'kind must be a string'
  }
}

function messageReason(message: unknown): string | undefined {
  if (!isObject(message)) return 'message must be an object'
  return refReason('message', message.ref)
    ?? idReason('message.chatId', message.chatId)
    ?? stringReason('message.senderId', message.senderId)
    ?? stringReason('message.type', message.type)
    ?? stringReason('message.body', message.body)
}

function interactionReason(interaction: unknown): string | undefined {
  if (!isObject(interaction)) return 'interaction must be an object'
  return refReason('interaction', interaction.ref)
    ?? idReason('interaction.chatId', interaction.chatId)
    ?? stringReason('interaction.senderId', interaction.senderId)
    ?? stringReason('interaction.data', interaction.data)
}

function refReason(owner: string, ref: unknown): string | undefined {
  if (!isObject(ref)) return `${owner}.ref must be an object`
  return stringReason(`${owner}.ref.id`, ref.id)
}

function idReason(field: string, value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? undefined : `${field} must be a non-empty string`
}

function stringReason(field: string, value: unknown): string | undefined {
  return typeof value === 'string' ? undefined : `${field} must be a string`
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
