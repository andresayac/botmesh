/**
 * Model-based test: random operation sequences (valid and malformed contacts, hostile
 * ids, segments) against MemoryContactStore (the reference) and KvContactStore: same
 * outcome for every call, same final state.
 */
import { describe, expect, it } from 'vitest'
import { MemoryKv } from '@botmesh/core'
import { KvContactStore, MemoryContactStore, type ContactStore } from '../src/index.js'
import { outcome, rng } from '../../../test-utils/prng.js'

const TENANTS = ['acme', 'globex', '}{', '🦜']
const IDS = ['p1', 'p2', '57300', 'ñ/1', '']
const TAGS = ['vip', 'new', 'café', '🦜', 'vip']

describe('ContactStore model: KvContactStore behaves like MemoryContactStore', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed)
      let now = 1_700_000_000_000
      const clock = () => now
      const stores: ContactStore[] = [new MemoryContactStore({ clock }), new KvContactStore(new MemoryKv(), { clock })]
      for (let step = 0; step < 300; step++) {
        now += r.int(3)
        const tenantId = r.pick(TENANTS)
        const id = r.pick(IDS)
        const op = r.int(4)
        let call: (s: ContactStore) => Promise<unknown>
        if (op === 0) {
          const input = {
            tenantId,
            id,
            channels: r.chance(0.95) ? { whatsapp: r.pick(['57300', '57301']) } : { whatsapp: 57300 },
            tags: r.chance(0.95) ? Array.from({ length: r.int(4) }, () => r.pick(TAGS)) : 'vip',
            attributes: r.chance(0.9) ? { country: r.pick(['CO', 'MX']), score: r.int(3) } : { score: r.pick([Number.NaN, null, { x: 1 }]) },
            marketingConsent: r.chance(0.95) ? r.chance(0.5) : 'yes',
          }
          call = (s) => s.upsert(input as never)
        } else if (op === 1) {
          const consent = r.chance(0.9) ? r.chance(0.5) : 'no'
          call = (s) => s.setConsent(tenantId, id, consent as never)
        } else if (op === 2) {
          const rule = {
            ...(r.chance(0.5) ? { tagsAll: [r.pick(TAGS)] } : {}),
            ...(r.chance(0.4) ? { attributes: { country: r.pick(['CO', 'MX']) } } : {}),
            ...(r.chance(0.4) ? { marketingConsent: r.chance(0.5) } : {}),
          }
          const options = { limit: r.pick([1, 10, 100]), scan: r.pick([3, 1000]) }
          call = (s) => s.segment(tenantId, rule, options)
        } else {
          call = (s) => s.get(tenantId, id)
        }
        const results = []
        for (const store of stores) results.push(await outcome(() => call(store)))
        expect(results[1], `seed ${seed} step ${step} op ${op}`).toEqual(results[0])
      }
      for (const tenantId of TENANTS) {
        expect(await stores[1]!.segment(tenantId, {}, { limit: 1000 })).toEqual(await stores[0]!.segment(tenantId, {}, { limit: 1000 }))
      }
    })
  }
})
