/**
 * Poll vote tracking for Telegram.
 *
 * A `poll_answer` update names its poll by id only: it carries neither the chat,
 * the message nor the option texts. The provider remembers each poll it sends
 * (the `sendPoll` result carries `poll.id`) so a later answer can be turned into
 * a {@link PollVote} with the same shape as the other channels: the ref of the
 * poll message plus per-option tallies with their voters. The cache is bounded
 * and in memory: a vote on a poll sent before a restart is dropped.
 */
import type { ChatId, PollVote } from '@botmesh/core'

/** Default number of polls remembered; the least recently used is evicted first. */
export const TELEGRAM_POLL_CACHE_MAX = 500

interface TrackedPoll {
  chatId: ChatId
  messageId: number
  nativeChatId: number | string
  options: string[]
  /** voter id → selected option indexes, in the order votes arrived. */
  votes: Map<string, number[]>
}

export class PollTracker {
  private readonly polls = new Map<string, TrackedPoll>()

  constructor(private readonly max = TELEGRAM_POLL_CACHE_MAX) {}

  /** Remember a poll from a `sendPoll` result; anything else is ignored. */
  remember(result: unknown, fallbackChatId: ChatId): void {
    if (typeof result !== 'object' || result === null) return
    const msg = result as { message_id?: unknown; chat?: { id?: unknown }; poll?: { id?: unknown; options?: unknown } }
    const poll = msg.poll
    if (typeof msg.message_id !== 'number' || !poll || typeof poll.id !== 'string' || poll.id === '' || !Array.isArray(poll.options)) return
    const options = poll.options.map((o) => (typeof o === 'object' && o !== null && typeof (o as { text?: unknown }).text === 'string' ? (o as { text: string }).text : ''))
    const rawChat = msg.chat?.id
    const nativeChatId = typeof rawChat === 'number' || (typeof rawChat === 'string' && rawChat !== '') ? rawChat : fallbackChatId
    this.polls.delete(poll.id)
    this.polls.set(poll.id, { chatId: String(nativeChatId), messageId: msg.message_id, nativeChatId, options, votes: new Map() })
    while (this.polls.size > this.max) {
      const oldest = this.polls.keys().next().value
      if (oldest === undefined) break
      this.polls.delete(oldest)
    }
  }

  /**
   * Record `voterId`'s current selection (empty = retracted) and return the
   * resulting vote, or undefined when the poll is unknown.
   */
  record(pollId: string, voterId: string, optionIds: number[]): PollVote | undefined {
    const poll = this.polls.get(pollId)
    if (!poll) return undefined
    // Touch: keep active polls in the cache.
    this.polls.delete(pollId)
    this.polls.set(pollId, poll)
    const selected = [...new Set(optionIds.filter((i) => i < poll.options.length))]
    poll.votes.delete(voterId)
    if (selected.length) poll.votes.set(voterId, selected)
    return {
      ref: { id: String(poll.messageId), chatId: poll.chatId, native: { chat_id: poll.nativeChatId, message_id: poll.messageId } },
      senderId: voterId,
      options: poll.options.map((name, index) => {
        const voters = [...poll.votes].filter(([, picks]) => picks.includes(index)).map(([id]) => id)
        return { name, votes: voters.length, voters }
      }),
    }
  }
}
