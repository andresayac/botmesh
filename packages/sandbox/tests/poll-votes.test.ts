/**
 * Keeps POLL_VOTE_PARSING honest: for every channel whose simulator can
 * deliver a native poll vote, send one through the real provider and check
 * whether the bot sees it (a 'poll' event). The set must list exactly the
 * channels that do, so the UI switches to native votes as soon as a provider
 * learns to parse them (and never sends votes a provider would drop).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { PollVote } from '@botmesh/core'
import { CHANNELS, POLL_VOTE_PARSING, connectBot, createSimulator } from '../src/providers.js'
import type { Harness } from '../src/harness.js'
import type { PlatformSimulator } from '../src/sim/base.js'
import type { IProvider } from '@botmesh/core'
import { silent } from './_bot.js'

let h: Harness<PlatformSimulator, IProvider> | undefined
afterEach(async () => { await h?.stop(); h = undefined })

const native = CHANNELS.filter((c) => createSimulator(c).nativePollVotes)

describe('native poll votes', () => {
  it('Telegram and Discord simulators deliver native votes', () => {
    expect([...native].sort()).toEqual(['discord', 'telegram'])
  })

  it('POLL_VOTE_PARSING only lists channels whose simulator delivers native votes', () => {
    for (const c of POLL_VOTE_PARSING) expect(native).toContain(c)
  })

  it.each(native)('%s: POLL_VOTE_PARSING matches whether the provider turns a native vote into a poll event', async (channel) => {
    const votes: PollVote[] = []
    const sim = createSimulator(channel)
    h = await connectBot(sim, (bot) => {
      bot.when('encuesta', (ctx) => ctx.poll('¿Pan o café?', ['Pan', 'Café']))
      bot.hook('poll', 'after', (vote: unknown) => { votes.push(vote as PollVote) })
    }, { logger: silent, bot: { logger: silent } })
    await sim.sendText('encuesta')
    const poll = await sim.waitForOutbound((r) => r.kind === 'poll', 8_000)
    await sim.send({ pollVote: { pollId: poll.targetId ?? poll.id, optionIds: [1] } })
    // A marker message after the vote: once it is answered, the vote (same chat queue) has been handled.
    await sim.sendText('encuesta')
    await sim.waitForOutboundCount(2, 8_000)
    await new Promise((r) => setTimeout(r, 200))
    expect(votes.length > 0, `${channel}: provider parsed the vote = ${votes.length > 0}; update POLL_VOTE_PARSING in src/providers.ts`).toBe(POLL_VOTE_PARSING.has(channel))
  }, 20_000)
})
