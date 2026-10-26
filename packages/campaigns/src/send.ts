/**
 * sendCampaign — plans a campaign and sends it with `bot.broadcast()`, settling every
 * queued delivery from the real broadcast result: accepted sends count (`sent`), final
 * failures and chats a hook skipped or the abort left pending release their slot
 * (`failed`). The per-chat FIFO is not involved (broadcast bypasses it); the bot's
 * `before`/`after('send')` hooks still run for every send.
 */

import type { Bot, BroadcastOptions, BroadcastResult, OutboundContent } from '@botmesh/core'
import type { CampaignPlanner } from './planner.js'
import type { Campaign, CampaignRecipient, Delivery } from './types.js'

/** One delivery the run could not settle (the broadcast itself already finished). */
export interface CampaignSettleError {
  deliveryId: string
  error: Error
}

/** What {@link sendCampaign} returns. */
export interface CampaignRun {
  /** Final deliveries, in the order `plan()` returned them (queued ones could not be settled). */
  deliveries: Delivery[]
  /** The raw broadcast result. */
  broadcast: BroadcastResult
  /** Settlements that failed (e.g. contention); the slot is released by its TTL. */
  settleErrors: CampaignSettleError[]
}

/**
 * Plan `campaign` over `recipients` and send `content` to the queued ones with
 * `bot.broadcast()`. A queued delivery is settled as `sent` when the provider accepted the
 * send to its chat (matched by the target chat id, whatever id the provider puts in the
 * message ref), and as `failed` when it failed, was skipped by a `before('send')` hook
 * or was left pending by an abort (with a reason in `error`). Two recipients that share
 * a `chatId` (defaults to the recipient id) are sent once; the repeats fail with
 * `'duplicate chatId'`. When `bot.broadcast()` itself rejects (invalid options), every
 * queued delivery is released as `failed` (`'broadcast rejected'`) before the error is rethrown.
 *
 * `options` is passed to `bot.broadcast()` (`batchSize`, `delayBetween`, `concurrency`,
 * `maxRetries`, `sendOptions`, `onProgress`, `onFail`, `signal`).
 */
export async function sendCampaign(
  bot: Bot,
  planner: CampaignPlanner,
  campaign: Campaign,
  recipients: readonly CampaignRecipient[],
  content: string | OutboundContent,
  options: BroadcastOptions = {},
): Promise<CampaignRun> {
  const deliveries = await planner.plan(campaign, recipients)
  // The first occurrence of a repeated recipient is the one plan() queued.
  const byId = new Map<string, CampaignRecipient>()
  for (const recipient of recipients) if (!byId.has(recipient.id)) byId.set(recipient.id, recipient)
  const chatOf = (delivery: Delivery): string => byId.get(delivery.recipientId)?.chatId ?? delivery.recipientId
  const settleErrors: CampaignSettleError[] = []

  // One target per chat: the first queued delivery wins, the repeats release their slot.
  const targets: string[] = []
  const queued: Delivery[] = []
  const claimed = new Set<string>()
  for (const delivery of deliveries) {
    if (delivery.state !== 'queued' || !delivery.deliveryId) continue
    const chatId = chatOf(delivery)
    if (claimed.has(chatId)) {
      const settled = await settle(delivery, settleErrors, () => planner.markFailed(delivery.deliveryId!, 'duplicate chatId'))
      if (settled) applySettled(delivery, settled)
      continue
    }
    claimed.add(chatId)
    targets.push(chatId)
    queued.push(delivery)
  }

  // Outcomes are keyed by the target chat id as passed to broadcast(). The accepted
  // messages' `ref.chatId` is the provider's (it may be canonicalized, e.g. a phone number
  // turned into a JID), so it cannot tell which target was sent: onProgress can, because
  // its `last.sent` counter only moves for an accepted (not hook-skipped) send.
  const outcomes = new Map<string, 'sent' | 'skipped'>()
  let sentSoFar = 0
  const userProgress = options.onProgress
  const onProgress: BroadcastOptions['onProgress'] = (done, total, last) => {
    if (last.ok) outcomes.set(last.chatId, last.sent > sentSoFar ? 'sent' : 'skipped')
    sentSoFar = last.sent
    userProgress?.(done, total, last)
  }

  let broadcast: BroadcastResult
  try {
    broadcast = await bot.broadcast(targets, content, { ...options, onProgress })
  } catch (error) {
    // Nothing was sent (broadcast only rejects for invalid options): release every slot.
    for (const delivery of queued) {
      const settled = await settle(delivery, settleErrors, () => planner.markFailed(delivery.deliveryId!, 'broadcast rejected'))
      if (settled) applySettled(delivery, settled)
    }
    throw error
  }
  const failed = new Map(broadcast.errors.map((failure) => [failure.chatId, failure.error]))
  const pending = new Set(broadcast.pending)

  for (const delivery of queued) {
    const chatId = chatOf(delivery)
    const settleAs = (): Promise<Delivery> => {
      if (outcomes.get(chatId) === 'sent') return planner.markSent(delivery.deliveryId!)
      if (failed.has(chatId)) return planner.markFailed(delivery.deliveryId!, failed.get(chatId)!.message)
      if (pending.has(chatId)) return planner.markFailed(delivery.deliveryId!, 'cancelled')
      return planner.markFailed(delivery.deliveryId!, 'skipped')
    }
    const settled = await settle(delivery, settleErrors, settleAs)
    if (settled) applySettled(delivery, settled)
  }

  return { deliveries, broadcast, settleErrors }
}

/** Copy the final state (and the failure reason, if any) onto the planned delivery. */
function applySettled(delivery: Delivery, settled: Delivery): void {
  delivery.state = settled.state
  if (settled.error !== undefined) delivery.error = settled.error
}

async function settle(
  delivery: Delivery,
  errors: CampaignSettleError[],
  run: () => Promise<Delivery>,
): Promise<Delivery | undefined> {
  try {
    return await run()
  } catch (error) {
    errors.push({ deliveryId: delivery.deliveryId!, error: error instanceof Error ? error : new Error(String(error)) })
    return undefined
  }
}
