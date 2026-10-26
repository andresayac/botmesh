/**
 * Model-based test: random operation sequences (valid and invalid, stale versions,
 * hostile ids) run against MemoryInboxStore (the reference) and KvInboxStore; every call
 * must have the same outcome and both must end in the same state.
 */
import { describe, expect, it } from 'vitest'
import { type StoredMessage } from '@botmesh/core'
import { MemoryKv } from '@botmesh/core/spi'
import { KvInboxStore, MemoryInboxStore, type InboxStore } from '../src/index.js'
import { outcome, rng } from '../../../test-utils/prng.js'

const TENANTS = ['acme', 'globex', 'a/b', '🦜']
const IDS = ['c1', 'c2', '57300@s.whatsapp.net', 'ñ:{x}', '']
const STATUSES = ['open', 'pending', 'resolved', 'bogus']

describe('InboxStore model: KvInboxStore behaves like MemoryInboxStore', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed)
      let now = 1_700_000_000_000
      const clock = () => now
      const stores: InboxStore[] = [new MemoryInboxStore({ clock }), new KvInboxStore(new MemoryKv(), { clock })]
      for (let step = 0; step < 300; step++) {
        now += r.int(3)
        const tenantId = r.pick(TENANTS)
        const id = r.pick(IDS)
        const op = r.int(7)
        const version = r.int(6)
        let call: (s: InboxStore) => Promise<unknown>
        if (op === 0) {
          const input = { tenantId, id, status: r.pick(STATUSES), handoff: r.chance(0.9) ? r.chance(0.5) : 'yes', ...(r.chance(0.3) ? { assigneeId: r.pick(['a1', 'a2', '']) } : {}), ...(r.chance(0.2) ? { slaDueAt: r.pick([now + 1000, Number.NaN]) } : {}) }
          const expected = r.chance(0.3) ? undefined : version
          call = (s) => s.upsert(input as never, expected)
        } else if (op === 1) {
          const patch = r.pick([{ status: r.pick(STATUSES) }, { handoff: r.chance(0.5) }, { assigneeId: r.pick(['a1', null, '']) }, { unread: r.pick([0, 3, -1]) }, { slaDueAt: r.pick([null, now, Number.POSITIVE_INFINITY]) }])
          call = (s) => s.update(tenantId, id, version, patch as never)
        } else if (op === 2) {
          const message: StoredMessage = { ref: { id: `m${step}`, chatId: id }, chatId: id, timestamp: now, type: 'text', tenantId, ...(r.chance(0.9) ? { direction: r.pick(['inbound', 'outbound'] as const) } : {}) }
          call = (s) => s.applyMessage(message)
        } else if (op === 3) {
          const body = r.pick(['nota', '  ', 'hola 👋'])
          const author = r.pick(['agent', ''])
          call = async (s) => {
            const note = await s.addNote(tenantId, id, author, body)
            return { body: note.body, conversationId: note.conversationId, createdAt: note.createdAt }
          }
        } else if (op === 4) {
          call = async (s) => (await s.listNotes(tenantId, id)).map((n) => n.body)
        } else if (op === 5) {
          const options = { ...(r.chance(0.5) ? { status: r.pick(['open', 'pending', 'resolved'] as const) } : {}), ...(r.chance(0.3) ? { assigneeId: 'a1' } : {}), limit: r.pick([1, 5, 100]), scan: r.pick([2, 1000]) }
          call = (s) => s.list(tenantId, options)
        } else {
          call = (s) => s.get(tenantId, id)
        }
        // Same call, same arguments (drawn once above), against each store.
        const results = []
        for (const store of stores) results.push(await outcome(() => call(store)))
        expect(results[1], `seed ${seed} step ${step} op ${op}`).toEqual(results[0])
      }
      for (const tenantId of TENANTS) {
        expect(await stores[1]!.list(tenantId, { limit: 1000 })).toEqual(await stores[0]!.list(tenantId, { limit: 1000 }))
      }
    })
  }
})
