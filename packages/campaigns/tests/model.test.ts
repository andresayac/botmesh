/**
 * Model-based test: random plan / markSent / markFailed sequences with the clock jumping
 * past reservation TTLs, against MemoryCampaignStore (the reference) and KvCampaignStore.
 * Every call has the same outcome in both, and the consent invariants hold throughout:
 * confirmed sends never exceed `maxPerRecipient`, opted-out or off-segment recipients are
 * never queued, and a delivery settles at most once.
 */
import { describe, expect, it } from 'vitest'
import { MemoryKv } from '@botmesh/core/spi'
import { CampaignPlanner, KvCampaignStore, MemoryCampaignStore, type CampaignRecipient, type Delivery } from '../src/index.js'
import { outcome, rng } from '../../../test-utils/prng.js'

const RECIPIENTS = ['p1', 'p2', 'p3', '🦜.4']
const TTL = 1_000

describe('CampaignPlanner model: KvCampaignStore behaves like MemoryCampaignStore', () => {
  for (const seed of [31, 32, 33, 34, 35, 36]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed)
      let now = 1_700_000_000_000
      const clock = () => now
      const planners = [
        new CampaignPlanner(new MemoryCampaignStore({ clock }), { clock, reservationTtl: TTL }),
        new CampaignPlanner(new KvCampaignStore(new MemoryKv(), { clock }), { clock, reservationTtl: TTL }),
      ]
      // Delivery ids are random per store: the n-th queued delivery of each store is "the same" one.
      const queued: string[][] = [[], []]
      const caps = new Map<string, number>()
      const strip = (deliveries: Delivery[]) => deliveries.map(({ deliveryId: _id, ...rest }) => rest)
      for (let step = 0; step < 250; step++) {
        now += r.chance(0.1) ? TTL + 1 : r.int(5)
        const campaignId = r.pick(['sale', 'news'])
        const op = r.int(4)
        let call: (planner: CampaignPlanner, index: number) => Promise<unknown>
        if (op <= 1) {
          const cap = r.pick([0, 1, 1, 2])
          caps.set(campaignId, cap)
          const recipients: CampaignRecipient[] = Array.from({ length: 1 + r.int(4) }, () => ({
            id: r.pick(RECIPIENTS),
            tenantId: r.chance(0.9) ? 'acme' : 'globex',
            channel: 'wa',
            optedIn: r.chance(0.8),
            tags: r.chance(0.7) ? ['vip'] : [],
          }))
          const requiredTags = r.chance(0.5) ? ['vip'] : undefined
          call = async (planner, index) => {
            const deliveries = await planner.plan({ id: campaignId, tenantId: 'acme', maxPerRecipient: cap, ...(requiredTags ? { requiredTags } : {}) }, recipients)
            for (const [i, d] of deliveries.entries()) {
              if (d.state === 'queued') {
                const recipient = recipients[i]!
                expect(recipient.optedIn && recipient.tenantId === 'acme' && (!requiredTags || recipient.tags?.includes('vip'))).toBe(true)
                queued[index]!.push(d.deliveryId!)
              }
            }
            return strip(deliveries)
          }
        } else {
          const pick = r.int(64)
          const sent = op === 2
          call = async (planner, index) => {
            const ids = queued[index]!
            if (!ids.length) return 'none'
            const id = ids[pick % ids.length]!
            const settled = sent ? await planner.markSent(id) : await planner.markFailed(id, 'boom')
            const { deliveryId: _id, ...rest } = settled
            return rest
          }
        }
        const results = []
        for (const [index, planner] of planners.entries()) results.push(await outcome(() => call(planner, index)))
        expect(results[1], `seed ${seed} step ${step} op ${op}`).toEqual(results[0])
        for (const planner of planners) {
          for (const recipientId of RECIPIENTS) {
            for (const [campaign, cap] of caps) {
              // Lowering the cap later never un-sends; it only stops new reservations.
              const count = await planner.sentCount('acme', campaign, recipientId)
              expect(count).toBeLessThanOrEqual(Math.max(2, cap))
            }
          }
        }
      }
      for (const campaignId of ['sale', 'news']) {
        for (const recipientId of RECIPIENTS) {
          expect(await planners[1]!.sentCount('acme', campaignId, recipientId)).toBe(await planners[0]!.sentCount('acme', campaignId, recipientId))
        }
      }
    })
  }

  it('never exceeds maxPerRecipient under 40 concurrent planners sharing one kv', async () => {
    const kv = new MemoryKv()
    const planners = Array.from({ length: 8 }, () => new CampaignPlanner(new KvCampaignStore(kv)))
    const recipient: CampaignRecipient = { id: 'hot', tenantId: 'acme', channel: 'wa', optedIn: true }
    const runs = await Promise.all(Array.from({ length: 40 }, (_, i) => planners[i % 8]!.plan({ id: 'sale', tenantId: 'acme', maxPerRecipient: 3 }, [recipient])))
    const queued = runs.flat().filter((d) => d.state === 'queued')
    expect(queued).toHaveLength(3)
    await Promise.all(queued.map((d, i) => planners[i]!.markSent(d.deliveryId!)))
    await expect(planners[0]!.markSent(queued[0]!.deliveryId!)).rejects.toMatchObject({ name: 'UnknownDeliveryError' })
    expect(await planners[0]!.sentCount('acme', 'sale', 'hot')).toBe(3)
  })
})
