/**
 * Scenario helpers over any simulator: the delivery problems real platforms
 * produce — duplicated and out-of-order webhooks, redeliveries, bursts,
 * expired media URLs and status sequences.
 */

import type { MessageStatus, PlatformSimulator, SendOutcome, UserInput } from './sim/base.js'

/** Deliver the SAME event `times` times (same message id), like a platform retry after a lost 200. */
export async function duplicate(sim: PlatformSimulator, input: UserInput, times = 2): Promise<SendOutcome[]> {
  const prepared = await sim.prepare(input)
  const out: SendOutcome[] = []
  for (let i = 0; i < times; i++) out.push(await sim.deliver(prepared))
  return out
}

/** Build every event first, then deliver them in reverse order (newest first). */
export async function outOfOrder(sim: PlatformSimulator, inputs: UserInput[]): Promise<SendOutcome[]> {
  const prepared = []
  for (const input of inputs) prepared.push(await sim.prepare({ ...input, ...(input.at === undefined ? { at: Date.now() + prepared.length } : {}) }))
  const out: SendOutcome[] = []
  for (const p of prepared.reverse()) out.push(await sim.deliver(p))
  return out
}

/** Deliver events concurrently (a burst from one or many users). */
export async function burst(sim: PlatformSimulator, inputs: UserInput[]): Promise<SendOutcome[]> {
  const prepared = []
  for (const input of inputs) prepared.push(await sim.prepare(input))
  return Promise.all(prepared.map((p) => sim.deliver(p)))
}

/**
 * Send media whose download URL has already expired when the bot fetches it
 * (the platform's URL lifetime ran out, or a replay came too late).
 */
export async function expiredMedia(sim: PlatformSimulator, input: UserInput): Promise<SendOutcome> {
  if (!input.media) throw new Error('expiredMedia needs a media input')
  const before = new Set(sim.media.list('user').map((m) => m.id))
  const prepared = await sim.prepare(input)
  for (const m of sim.media.list('user')) if (!before.has(m.id)) sim.media.expire(m.id)
  return sim.deliver(prepared)
}

/** Deliver a sequence of statuses for one bot message (default sent → delivered → read). */
export async function statusSequence(sim: PlatformSimulator, messageId: string, steps: MessageStatus[] = ['sent', 'delivered', 'read']): Promise<SendOutcome[]> {
  const out: SendOutcome[] = []
  for (const s of steps) out.push(await sim.status(messageId, s))
  return out
}
