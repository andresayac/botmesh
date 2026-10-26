/**
 * Chaos against a REAL Redis Cluster (opt-in: BOTWA_TEST_REDIS_CLUSTER_URL and
 * BOTWA_TEST_REDIS_CLUSTER_CHAOS=1): a manual failover under write load and a slot
 * migration between masters.
 *
 * These tests change the cluster's topology, so they live in their own file, which
 * vitest.config.ts runs in a later group (`sequence.groupOrder`) once every other suite
 * of this package has finished: a suite that opens a cluster client while a failover is
 * in flight could otherwise fail its initial slot discovery.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from 'redis'
import type { StoredMessage } from '@botmesh/core'
import { RedisStore } from '../src/index.js'
import { hashSlot, storeKeys } from '../src/internal.js'
import {
  CHAOS, CLUSTER_URL, cleanupPrefix, connectCluster, connectNode, runPrefix, waitClusterOk,
} from './clusterEnv.js'
import type { NodeRedisCluster } from './nodeRedis.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const msg = (chatId: string, id: string, ts: number): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: ts, type: 'text', body: `b-${id}`, fromMe: false,
})

describe.skipIf(!CLUSTER_URL || !CHAOS)('Redis Cluster (real) chaos', () => {
  let cluster: NodeRedisCluster
  let node: Awaited<ReturnType<typeof connectNode>>
  const mine: string[] = []
  const prefix = (tag: string) => { const p = runPrefix(tag); mine.push(p); return p }

  beforeAll(async () => {
    node = await connectNode()
    await waitClusterOk(node)
    cluster = await connectCluster()
  })

  afterAll(async () => {
    for (const p of mine) await cleanupPrefix(cluster, p).catch(() => {})
    await cluster?.quit()
    await node?.quit()
  })

  const host = () => new URL(CLUSTER_URL!).hostname
  type NodeLine = { id: string; port: number; master: boolean; masterOf?: string; ranges: Array<[number, number]> }
  const parse = (l: string): NodeLine => {
    const f = l.split(' ')
    return {
      id: f[0]!,
      port: Number(f[1]!.split('@')[0]!.split(':')[1]),
      master: f[2]!.split(',').includes('master') && !f[2]!.includes('fail'),
      masterOf: f[3] === '-' ? undefined : f[3],
      ranges: f.slice(8).filter((r) => !r.startsWith('[')).map((r) => { const [lo, hi] = r.split('-').map(Number); return [lo!, hi ?? lo!] as [number, number] }),
    }
  }
  /** Every node as it describes ITSELF (another node's view of it may lag behind a failover). */
  async function topology(): Promise<NodeLine[]> {
    const ports = String(await node.sendCommand(['CLUSTER', 'NODES'])).trim().split(/\r?\n/).map((l) => parse(l).port)
    return Promise.all(ports.map(async (port) => {
      const c = await conn(port)
      try {
        const self = String(await c.sendCommand(['CLUSTER', 'NODES'])).trim().split(/\r?\n/).find((l) => l.includes('myself'))!
        return parse(self)
      } finally {
        await c.quit()
      }
    }))
  }
  const owner = (nodes: NodeLine[], slot: number) => nodes.find((n) => n.master && n.ranges.some(([lo, hi]) => slot >= lo && slot <= hi))!
  async function conn(port: number) {
    const c = createClient({ url: `redis://${host()}:${port}` })
    c.on('error', () => {})
    await c.connect()
    return c
  }

  it('keeps working through a manual failover (CLUSTER FAILOVER on a replica)', async () => {
    const p = prefix('failover-chaos')
    const store = new RedisStore({ client: cluster, prefix: p })
    await store.start()
    // A master that has a replica (replica migration can leave one without), and a chat on it.
    const nodes = await topology()
    const old = nodes.find((m) => m.master && nodes.some((r) => r.masterOf === m.id))!
    const replicaOf = nodes.find((n) => n.masterOf === old.id)!
    let chat = ''
    for (let i = 0; !chat; i++) {
      const candidate = `chaos-${i}`
      if (old.ranges.some(([lo, hi]) => { const s = hashSlot(storeKeys(p, 'cluster').msgSet(candidate)); return s >= lo && s <= hi })) chat = candidate
    }
    const slot = hashSlot(storeKeys(p, 'cluster').msgSet(chat))
    const promoted = await conn(replicaOf.port)
    let stop = false
    let n = 0
    const errors: unknown[] = []
    const load = (async () => {
      while (!stop) {
        try {
          await store.saveMessage(msg(chat, `m${n}`, n))
          n++
        } catch (err) { errors.push(err) }
        await sleep(5)
      }
    })()
    await sleep(300)
    // Switched: the promoted node owns the slot and the old master no longer claims it.
    const switched = async () => {
      const now = await topology()
      const self = (id: string) => now.find((n) => n.id === id)!
      const claims = (n: NodeLine) => n.master && n.ranges.some(([lo, hi]) => slot >= lo && slot <= hi)
      expect(claims(self(replicaOf.id))).toBe(true)
      expect(claims(self(old.id))).toBe(false)
    }
    await promoted.sendCommand(['CLUSTER', 'FAILOVER'])
    try {
      await vi.waitFor(switched, { timeout: 10_000, interval: 200 })
    } catch {
      // Masters refuse to vote twice for one master's failover within 2 × node-timeout
      // (back-to-back runs): take over without a vote instead.
      const role = (await promoted.sendCommand(['ROLE'])) as unknown[]
      if (role[0] !== 'master') await promoted.sendCommand(['CLUSTER', 'FAILOVER', 'TAKEOVER'])
      await vi.waitFor(switched, { timeout: 20_000, interval: 200 })
    }
    await waitClusterOk(node)
    await sleep(500)
    stop = true
    await load
    await promoted.quit()
    // Once the topology settled, every write goes through (MOVED is followed for routed scripts).
    for (let i = 0; i < 20; i++) await store.saveMessage(msg(chat, `after${i}`, 1e6 + i))
    const saved = await store.getMessagesByChat(chat, 1e6)
    expect(saved.filter((m) => m.ref.id.startsWith('after'))).toHaveLength(20)
    expect(saved.length).toBe(n + 20)
  }, 90_000)

  it('listings stay complete and writes go through while a chat-index slot migrates between masters', async () => {
    const p = prefix('migrating')
    const store = new RedisStore({ client: cluster, prefix: p })
    await store.start()
    const keys = storeKeys(p, 'cluster')
    const chat = 'moving'
    await store.upsertChat({ id: chat })
    for (let i = 0; i < 20; i++) await store.saveMessage(msg(chat, `m${i}`, i))
    const slot = hashSlot(keys.chatIndex(chat)!)
    await waitClusterOk(node)
    // Wait until every node the seed calls a master agrees (a previous failover may still propagate).
    let nodes: NodeLine[] = []
    await vi.waitFor(async () => {
      nodes = await topology()
      for (const m of nodes.filter((x) => x.master)) {
        const c = await conn(m.port)
        const role = (await c.sendCommand(['ROLE'])) as unknown[]
        await c.quit()
        expect(role[0]).toBe('master')
      }
    }, { timeout: 30_000, interval: 300 })
    const src = owner(nodes, slot)
    const dst = nodes.find((n) => n.master && n.id !== src.id)!
    const s = await conn(src.port)
    const d = await conn(dst.port)
    const all = await Promise.all(nodes.filter((x) => x.master).map((m) => conn(m.port)))
    try {
      await d.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'IMPORTING', src.id])
      await s.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'MIGRATING', dst.id])
      // Move one of the slot's two keys: the record and its index now sit on different nodes.
      const inSlot = (await s.sendCommand(['CLUSTER', 'GETKEYSINSLOT', String(slot), '1000'])) as string[]
      // (Bucket tags carry no prefix: other prefixes' chat records may share the slot.)
      expect(inSlot.filter((k) => k.startsWith(`${p}:`)).sort()).toEqual([keys.chat(chat), keys.chatIndex(chat)!].sort())
      await s.sendCommand(['MIGRATE', host(), String(dst.port), '', '0', '5000', 'KEYS', keys.chatIndex(chat)!])
      // Mid-migration: reads follow ASK, so the listing is complete.
      expect((await store.listChats()).map((c) => c.id)).toEqual([chat])
      expect(await store.getChat(chat)).toEqual({ id: chat })
      // A multi-key script on a split slot gets TRYAGAIN: retried until the move completes.
      const during = store.upsertChat({ id: chat, name: 'during' })
      await sleep(30)
      const rest = (await s.sendCommand(['CLUSTER', 'GETKEYSINSLOT', String(slot), '1000'])) as string[]
      if (rest.length) await s.sendCommand(['MIGRATE', host(), String(dst.port), '', '0', '5000', 'KEYS', ...rest])
      for (const c of all) await c.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'NODE', dst.id])
      await during
      expect(await store.getChat(chat)).toEqual({ id: chat, name: 'during' })
      expect((await store.listChats()).map((c) => c.id)).toEqual([chat])
      await store.deleteChat(chat)
      expect(await store.listChats()).toEqual([])
      expect(await store.getMessagesByChat(chat, 100)).toEqual([])
    } finally {
      // Never leave the slot half-migrated: assign it to whoever holds its keys now.
      const holder = ((await d.sendCommand(['CLUSTER', 'COUNTKEYSINSLOT', String(slot)])) as number) > 0 ? dst.id : src.id
      for (const c of [s, d]) await c.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'STABLE']).catch(() => {})
      for (const c of all) await c.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'NODE', holder]).catch(() => {})
      // Make the new owner's claim win gossip (a later failover must know the slot moved).
      await (holder === dst.id ? d : s).sendCommand(['CLUSTER', 'BUMPEPOCH']).catch(() => {})
      await waitClusterOk(node)
      for (const c of [s, d, ...all]) await c.quit().catch(() => {})
    }
  }, 60_000)
})
