import { describe, it, expect, vi, afterEach } from 'vitest'
import type { InboundEvent, PollVote } from '@botmesh/core'
import { TelegramProvider, parsePollAnswer } from '../src/index.js'

afterEach(() => vi.unstubAllGlobals())

const pollMessage = {
  message_id: 501,
  date: 1_700_000_000,
  chat: { id: -100, type: 'supergroup', title: 'Team' },
  from: { id: 9, is_bot: true, first_name: 'Bot' },
  poll: { id: 'P1', question: 'Color?', options: [{ text: 'Red', voter_count: 0 }, { text: 'Blue', voter_count: 0 }], allows_multiple_answers: true },
}

function stubSendPoll(result: unknown = pollMessage): Array<{ url: string; body: Record<string, unknown> }> {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, result }) }
  }))
  return calls
}

function webhookProvider(extra: Record<string, unknown> = {}): { p: TelegramProvider; votes: PollVote[] } {
  const p = new TelegramProvider({ token: 'TOK', polling: false, allowUnsignedWebhooks: true, selfId: '9', ...extra })
  const votes: PollVote[] = []
  p.onEvent((e: InboundEvent) => { if (e.kind === 'poll-vote') votes.push(e.vote) })
  return { p, votes }
}

describe('Telegram poll_answer', () => {
  it('parsePollAnswer reads the poll id, the voter and the selected option indexes', () => {
    expect(parsePollAnswer({ update_id: 1, poll_answer: { poll_id: 'P1', user: { id: 77, first_name: 'Ana' }, option_ids: [1] } }))
      .toEqual({ pollId: 'P1', voterId: '77', optionIds: [1] })
    // A vote cast on behalf of a chat (anonymous admin) names the chat.
    expect(parsePollAnswer({ update_id: 1, poll_answer: { poll_id: 'P1', voter_chat: { id: -100, type: 'supergroup' }, user: { id: 136817688 }, option_ids: [0] } }))
      .toEqual({ pollId: 'P1', voterId: '-100', optionIds: [0] })
    // A retracted vote has no options.
    expect(parsePollAnswer({ update_id: 1, poll_answer: { poll_id: 'P1', user: { id: 77 }, option_ids: [] } }))
      .toEqual({ pollId: 'P1', voterId: '77', optionIds: [] })
    // Malformed answers are skipped.
    expect(parsePollAnswer({ update_id: 1, poll_answer: { poll_id: '', user: { id: 77 }, option_ids: [0] } })).toBeUndefined()
    expect(parsePollAnswer({ update_id: 1, poll_answer: { poll_id: 'P1', option_ids: [0] } })).toBeUndefined()
    expect(parsePollAnswer({ update_id: 1, poll_answer: { poll_id: 'P1', user: { id: 77 }, option_ids: ['x', -1, 0.5, 1] as unknown as number[] } }))
      .toEqual({ pollId: 'P1', voterId: '77', optionIds: [1] })
    expect(parsePollAnswer({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } })).toBeUndefined()
  })

  it('sends polls as non-anonymous so their votes reach the bot (anonymousPolls keeps the old behaviour)', async () => {
    const calls = stubSendPoll()
    const { p } = webhookProvider()
    await p.send('-100', { kind: 'poll', question: 'Color?', options: ['Red', 'Blue'] })
    expect(calls[0]!.body).toMatchObject({ is_anonymous: false })

    const anon = webhookProvider({ anonymousPolls: true }).p
    await anon.send('-100', { kind: 'poll', question: 'Color?', options: ['Red', 'Blue'] })
    expect(calls[1]!.body.is_anonymous).toBeUndefined()

    // platformData still overrides it per send.
    await p.send('-100', { kind: 'poll', question: 'Color?', options: ['Red', 'Blue'] }, { platformData: { is_anonymous: true } })
    expect(calls[2]!.body.is_anonymous).toBe(true)
  })

  it('a vote on a poll the bot sent becomes a poll-vote with the same shape as Baileys (ref of the poll message, tallies with voters)', async () => {
    stubSendPoll()
    const { p, votes } = webhookProvider()
    await p.send('-100', { kind: 'poll', question: 'Color?', options: ['Red', 'Blue'], multiSelect: true })

    expect(p.ingest({ update_id: 10, poll_answer: { poll_id: 'P1', user: { id: 77, first_name: 'Ana' }, option_ids: [1] } })).toBe(200)
    expect(p.ingest({ update_id: 11, poll_answer: { poll_id: 'P1', user: { id: 78, first_name: 'Bo' }, option_ids: [0, 1] } })).toBe(200)
    expect(votes).toHaveLength(2)
    expect(votes[0]).toEqual({
      ref: { id: '501', chatId: '-100', native: { chat_id: -100, message_id: 501 } },
      senderId: '77',
      options: [{ name: 'Red', votes: 0, voters: [] }, { name: 'Blue', votes: 1, voters: ['77'] }],
    })
    expect(votes[1]!.senderId).toBe('78')
    expect(votes[1]!.options).toEqual([{ name: 'Red', votes: 1, voters: ['78'] }, { name: 'Blue', votes: 2, voters: ['77', '78'] }])

    // A changed vote replaces the voter's selection; a retraction clears it.
    p.ingest({ update_id: 12, poll_answer: { poll_id: 'P1', user: { id: 77 }, option_ids: [0] } })
    expect(votes[2]!.options).toEqual([{ name: 'Red', votes: 2, voters: ['78', '77'] }, { name: 'Blue', votes: 1, voters: ['78'] }])
    p.ingest({ update_id: 13, poll_answer: { poll_id: 'P1', user: { id: 78 }, option_ids: [] } })
    expect(votes[3]!.options).toEqual([{ name: 'Red', votes: 1, voters: ['77'] }, { name: 'Blue', votes: 0, voters: [] }])
  })

  it('drops a vote for a poll this process has not seen and option indexes out of range', async () => {
    stubSendPoll()
    const { p, votes } = webhookProvider()
    expect(p.ingest({ update_id: 1, poll_answer: { poll_id: 'UNKNOWN', user: { id: 77 }, option_ids: [0] } })).toBe(200)
    expect(votes).toHaveLength(0)
    await p.send('-100', { kind: 'poll', question: 'Color?', options: ['Red', 'Blue'] })
    p.ingest({ update_id: 2, poll_answer: { poll_id: 'P1', user: { id: 77 }, option_ids: [5, 1] } })
    expect(votes[0]!.options).toEqual([{ name: 'Red', votes: 0, voters: [] }, { name: 'Blue', votes: 1, voters: ['77'] }])
  })

  it('requests poll_answer updates while long polling', async () => {
    const urls: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push({ url, body: String(init?.body ?? '') })
      const result = url.endsWith('/getMe') ? { id: 9, is_bot: true, first_name: 'B' } : []
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, result }) }
    }))
    const polling = new TelegramProvider({ token: 'TOK', pollTimeout: 1, pollIdleMs: 5 })
    await polling.start()
    const t0 = Date.now()
    while (!urls.some((u) => u.url.includes('/getUpdates')) && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 5))
    await polling.stop()
    const gu = urls.find((u) => u.url.includes('/getUpdates'))!
    expect(JSON.parse(gu.body).allowed_updates).toContain('poll_answer')
  })
})
