/**
 * Model-based randomized test for IStore implementations.
 *
 * Replays seeded random sequences of store operations against the store under test
 * and against `MemoryStore` (the reference of the contract, uncapped) and compares
 * every read. Ids and chat ids are drawn from small pools full of the inputs that
 * have broken stores before: `:` and `%` (escaped message keys and their legacy
 * form), glob metacharacters (`*?[]\`, Redis SCAN patterns), unicode and emoji,
 * spaces and empty strings. Timestamps are unique per save so the window order is
 * fully determined (ties are covered by the conformance suite).
 *
 * Wire it from a store's tests:
 *
 * ```ts
 * import { runStoreModelFuzz } from '../../../test-utils/store-model-fuzz.js'
 * runStoreModelFuzz('MyStore', { async make() { ...; return { store, teardown } } })
 * ```
 *
 * A failure prints the seed and the operation index; re-run one seed with `seeds: [n]`.
 * `BOTWA_FUZZ_SEEDS=<n>` replays seeds 1..n instead of the default four (harnesses that
 * pass their own `seeds` keep them).
 */
import { describe, it, expect } from 'vitest'
import { MemoryStore, type FlowCheckpoint, type IStore, type StoredMessage } from '@botmesh/core'
import { type UserDataEntry } from '@botmesh/core/spi'

export interface StoreModelFuzzHarness {
  /** Build a fresh, started, EMPTY store and a teardown that releases it. */
  make(): Promise<{ store: IStore; teardown: () => Promise<void> }>
  /** Seeds to replay (default: 1..4). */
  seeds?: number[]
  /** Operations per seed (default 300). */
  ops?: number
  /** Per-test timeout in ms (default 60 s; real servers are slower than fakes). */
  timeout?: number
}

/** mulberry32: tiny seeded PRNG, enough for reproducible fuzzing. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CHATS = ['whatsapp:+1555', 'a:b', 'a', 'b:c', '%3A', 'a%3Ab', 'x*y', 'q?', '[g]', 'a\\b', 'グループ', '🔥 chat', 'c']
const IDS = ['m1', 'b:c', 'c', ':', '%3A', '%', '%25', 'a:b:c', 'SM:1', '*', '[1]', '\\', 'ñandú', '🎉', 'id with space', '']
const USERS = ['u1', 'u:2', '%3A', '*', '🙂', 'u1:ns']
const NAMESPACES = ['n', 'n:x', '%', '*']
const KEYS = ['k', 'k:1', '%3A', '🔑']
/** A lone surrogate survives JSON (escaped) but not a raw UTF-8 value, so cursors skip it. */
const LONE_SURROGATE = '\uD83D lone surrogate'
const BODIES = ['hola', '', 'ñ 🌮 \u0000 nul', 'a'.repeat(300), '"quoted" {json}', '😀', LONE_SURROGATE, 'línea\nnueva']
const RAW_VALUES = BODIES.filter((b) => b !== LONE_SURROGATE)

type Op = (step: number) => Promise<void>

function sortBy<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

export function runStoreModelFuzz(name: string, h: StoreModelFuzzHarness): void {
  const seeds = h.seeds ?? (process.env.BOTWA_FUZZ_SEEDS ? Array.from({ length: Number(process.env.BOTWA_FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 2, 3, 4])
  const ops = h.ops ?? 300
  describe(`IStore model fuzz: ${name}`, () => {
    for (const seed of seeds) {
      it(`matches MemoryStore on a random op sequence (seed ${seed})`, async () => {
        const rnd = prng(seed)
        const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
        const model = new MemoryStore({ maxMessagesPerChat: Infinity })
        const { store, teardown } = await h.make()
        let clock = 1_000
        const revisions = new Map<string, number>()
        // MemoryStore keeps a re-saved message at its first position; the window contract is
        // "newest by timestamp", so the model's log is ordered by timestamp before windowing.
        const window = async (chatId: string, limit: number) => {
          const all = [...(await model.getMessagesByChat(chatId, Infinity))].sort((a, b) => a.timestamp - b.timestamp)
          return all.slice(Math.max(0, all.length - limit))
        }
        const where = (step: number, what: string) => `seed ${seed}, op #${step}: ${what}`
        const userData = typeof store.setUserData === 'function'
        const cas = typeof store.setCheckpointIf === 'function'
        try {
          const table: Array<[number, Op]> = [
            [8, async () => {
              const chatId = pick(CHATS)
              const id = pick(IDS)
              const m: StoredMessage = {
                ref: { id, chatId }, chatId, senderId: pick(USERS), timestamp: ++clock,
                type: 'text', body: pick(BODIES), fromMe: rnd() < 0.5,
              }
              await Promise.all([model.saveMessage(m), store.saveMessage(m)])
            }],
            [3, async (step) => {
              const ref = { chatId: pick(CHATS), id: pick(IDS) }
              expect(await store.getMessage(ref), where(step, `getMessage ${JSON.stringify(ref)}`)).toEqual(await model.getMessage(ref))
            }],
            [2, async () => {
              const ref = { chatId: pick(CHATS), id: pick(IDS) }
              await Promise.all([model.deleteMessage(ref), store.deleteMessage(ref)])
            }],
            [4, async (step) => {
              const chatId = pick(CHATS)
              const limit = pick([1, 2, 3, 5, 50, Infinity])
              const got = (await store.getMessagesByChat(chatId, limit)).map((m) => `${m.ref.id}|${m.body}`)
              const want = (await window(chatId, limit)).map((m) => `${m.ref.id}|${m.body}`)
              expect(got, where(step, `getMessagesByChat ${JSON.stringify(chatId)} limit ${limit}`)).toEqual(want)
            }],
            [1, async () => {
              const chatId = pick(CHATS)
              await Promise.all([model.deleteChat(chatId), store.deleteChat(chatId)])
            }],
            [3, async () => {
              const id = pick(CHATS)
              const patch = rnd() < 0.5 ? { id, name: pick(BODIES) } : { id, lastMessageAt: ++clock, tags: ['a', pick(BODIES)] }
              await Promise.all([model.upsertChat(patch), store.upsertChat(patch)])
            }],
            [2, async (step) => {
              const id = pick(CHATS)
              expect(await store.getChat(id), where(step, `getChat ${JSON.stringify(id)}`)).toEqual(await model.getChat(id))
            }],
            [1, async (step) => {
              const got = sortBy(await store.listChats(), (c) => c.id)
              expect(got, where(step, 'listChats')).toEqual(sortBy(await model.listChats(), (c) => c.id))
            }],
            [2, async () => {
              const id = pick(USERS)
              const patch = rnd() < 0.5 ? { id, name: pick(BODIES) } : { id, phoneNumber: '+57 300' }
              await Promise.all([model.upsertContact(patch), store.upsertContact(patch)])
            }],
            [1, async () => {
              const id = pick(USERS)
              await Promise.all([model.deleteContact(id), store.deleteContact(id)])
            }],
            [1, async (step) => {
              const got = sortBy(await store.listContacts(), (c) => c.id)
              expect(got, where(step, 'listContacts')).toEqual(sortBy(await model.listContacts(), (c) => c.id))
            }],
            [2, async (step) => {
              const key = pick(CHATS)
              if (!store.setCursor || !store.getCursor) return // optional part of IStore
              if (rnd() < 0.5) {
                const value = pick(RAW_VALUES)
                await Promise.all([model.setCursor(key, value), store.setCursor(key, value)])
              } else {
                expect(await store.getCursor(key), where(step, `getCursor ${JSON.stringify(key)}`)).toEqual(await model.getCursor(key))
              }
            }],
            [3, async (step) => {
              const key = pick(CHATS)
              const r = rnd()
              if (cas && r < 0.4) {
                // Compare-and-set with either the right or a stale revision: both stores must agree.
                const current = revisions.get(key) ?? 0
                const expected = rnd() < 0.7 ? current : current + 1
                const cp: FlowCheckpoint = { flowId: 'f', step: Math.floor(rnd() * 5), state: { body: pick(BODIES) }, updatedAt: ++clock, revision: expected + 1 }
                const got = await store.setCheckpointIf!(key, cp, expected)
                const want = await model.setCheckpointIf!(key, cp, expected)
                expect(got, where(step, `setCheckpointIf ${JSON.stringify(key)} @${expected}`)).toBe(want)
                if (want) revisions.set(key, expected + 1)
              } else if (r < 0.6) {
                const cp: FlowCheckpoint = { flowId: 'f', step: 1, state: { n: ++clock }, updatedAt: clock }
                revisions.delete(key)
                await Promise.all([model.setCheckpoint(key, cp), store.setCheckpoint(key, cp)])
              } else if (r < 0.75) {
                revisions.delete(key)
                await Promise.all([model.clearCheckpoint(key), store.clearCheckpoint(key)])
              } else {
                expect(await store.getCheckpoint(key), where(step, `getCheckpoint ${JSON.stringify(key)}`)).toEqual(await model.getCheckpoint(key))
              }
            }],
            [1, async (step) => {
              const got = sortBy(await store.listCheckpoints(), ([k]) => k)
              expect(got, where(step, 'listCheckpoints')).toEqual(sortBy(await model.listCheckpoints(), ([k]) => k))
            }],
            [2, async (step) => {
              const key = pick(CHATS)
              if (rnd() < 0.5) {
                const history = [{ role: 'user' as const, content: pick(BODIES) }]
                await Promise.all([model.setConversation(key, history), store.setConversation(key, history)])
              } else {
                expect(await store.getConversation(key), where(step, `getConversation ${JSON.stringify(key)}`)).toEqual(await model.getConversation(key))
              }
            }],
            [userData ? 4 : 0, async (step) => {
              const userId = pick(USERS)
              const namespace = pick(NAMESPACES)
              const key = pick(KEYS)
              const r = rnd()
              if (r < 0.4) {
                const entry: UserDataEntry = { userId, namespace, key, value: { v: pick(BODIES), n: ++clock }, updatedAt: clock }
                await Promise.all([model.setUserData!(entry), store.setUserData!(entry)])
              } else if (r < 0.55) {
                const args: [string, string?, string?] = rnd() < 0.33 ? [userId] : rnd() < 0.5 ? [userId, namespace] : [userId, namespace, key]
                await Promise.all([model.deleteUserData!(...args), store.deleteUserData!(...args)])
              } else if (r < 0.8) {
                expect(await store.getUserData!(userId, namespace, key), where(step, `getUserData ${userId}/${namespace}/${key}`))
                  .toEqual(await model.getUserData!(userId, namespace, key))
              } else {
                const ns = rnd() < 0.5 ? namespace : undefined
                const show = (xs: UserDataEntry[]) => sortBy(xs, (e) => `${e.namespace}\u0000${e.key}`)
                expect(show(await store.listUserData!(userId, ns)), where(step, `listUserData ${userId}/${String(ns)}`))
                  .toEqual(show(await model.listUserData!(userId, ns)))
              }
            }],
          ]
          const total = table.reduce((n, [w]) => n + w, 0)
          for (let step = 0; step < ops; step++) {
            let roll = rnd() * total
            for (const [weight, op] of table) {
              if ((roll -= weight) < 0) { await op(step); break }
            }
          }
          // Final full comparison of every chat's log.
          for (const chatId of CHATS) {
            const got = (await store.getMessagesByChat(chatId, Infinity)).map((m) => m.ref.id)
            expect(got, `seed ${seed}: final log of ${JSON.stringify(chatId)}`).toEqual((await window(chatId, Infinity)).map((m) => m.ref.id))
          }
        } finally {
          await teardown()
        }
      }, h.timeout ?? 60_000)
    }
  })
}
