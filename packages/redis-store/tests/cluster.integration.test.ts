/**
 * The cluster key layout against a REAL Redis Cluster (opt-in): every shared conformance
 * suite, the behaviour probes, real CLUSTER KEYSLOT checks, multi-replica coordination
 * (in-process and a killed child process). The chaos tests (failover, slot migration)
 * are in cluster-chaos.integration.test.ts.
 *
 * Skipped unless BOTWA_TEST_REDIS_CLUSTER_URL is set (see clusterEnv.ts / CONTRIBUTING);
 * the child-process test needs `lib/`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Bot, MemoryStore, flow, type Coordinator, type StoredMessage } from '@botmesh/core'
import { legacyMessageKey, type Ticket } from '@botmesh/core/spi'
import { CrashableProvider, MockProvider, crashable } from '@botmesh/core/testing'
import {
  RedisCoordinator, RedisDurability, RedisDurableKv, RedisStore, hashSlot,
} from '../src/index.js'
import { storeKeys, coordKeys } from '../src/layout.js'
import { scanEverywhere } from '../src/migrate.js'
import { asRedisLike } from '../src/client.js'
import {
  CLUSTER_URL, cleanupPrefix, clusterOptions, connectCluster, connectNode, keySlot, runPrefix, waitClusterOk,
} from './clusterEnv.js'
import { CLUSTER_PROBES, probeMeets, probeOutcome } from './cluster-probes.js'
import { runStoreConformance } from '../../../test-utils/store-conformance.js'
import { runUserDataConformance } from '../../../test-utils/user-data-conformance.js'
import { runStoreModelFuzz } from '../../../test-utils/store-model-fuzz.js'
import { runScheduleStoreConformance } from '../../../test-utils/schedule-store-conformance.js'
import { runLeaseConformance } from '../../../test-utils/lease-conformance.js'
import { runDurabilityConformance, runDurableKvConformance } from '../../../test-utils/durability-conformance.js'
import { runCrashRecoveryMatrix, type CrashMatrixDeps } from '../../../test-utils/durability-crash.js'
import { REDIS_CLIENT_MAJOR, type NodeRedisCluster } from './nodeRedis.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const texts = (p: MockProvider) => p.outbox.map((m) => (m.content.kind === 'text' ? m.content.text : `[${m.content.kind}]`))
const HOLDER = fileURLToPath(new URL('./fixtures/coord-holder-cluster.mjs', import.meta.url))
const BUILT = existsSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)))
const msg = (chatId: string, id: string, ts: number): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: ts, type: 'text', body: `b-${id}`, fromMe: false,
})

/** One cluster client shared by the conformance suites (lazy, closed after the file). */
let shared: Promise<NodeRedisCluster> | undefined
const sharedClient = () => (shared ??= connectCluster())
const prefixes: string[] = []
function freshPrefix(tag: string): string {
  const p = runPrefix(tag)
  prefixes.push(p)
  return p
}

afterAll(async () => {
  if (!shared) return
  const c = await shared
  for (const p of prefixes) await cleanupPrefix(c, p).catch(() => {})
  await c.quit()
})

if (CLUSTER_URL) {
  runStoreConformance('RedisStore (real cluster)', {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('store')
      const store = new RedisStore({ client, prefix })
      await store.start()
      const keys = storeKeys(prefix, 'cluster')
      return {
        store,
        teardown: () => cleanupPrefix(client, prefix),
        seedLegacyMessage: async (m: StoredMessage) => {
          const member = legacyMessageKey(m.ref)
          await client.set(keys.msgItem(m.chatId, member), JSON.stringify(m))
          await client.zAdd(keys.msgSet(m.chatId), { score: m.timestamp, value: member })
        },
      }
    },
  })

  runStoreModelFuzz('RedisStore (real cluster)', {
    seeds: [1, 2],
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('fuzz')
      const store = new RedisStore({ client, prefix })
      await store.start()
      return { store, teardown: () => cleanupPrefix(client, prefix) }
    },
  })

  runUserDataConformance('RedisStore (real cluster)', {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('ud')
      const store = new RedisStore({ client, prefix })
      await store.start()
      return { store, teardown: () => cleanupPrefix(client, prefix) }
    },
  })

  runScheduleStoreConformance('RedisScheduleStore (real cluster)', {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('sched')
      const store = new RedisStore({ client, prefix })
      await store.start()
      return { store: store.schedules(), teardown: () => cleanupPrefix(client, prefix) }
    },
  })

  runLeaseConformance('RedisLeaseProvider (real cluster)', {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('lease')
      return { lease: new RedisStore({ client, prefix }).leases(), teardown: () => cleanupPrefix(client, prefix) }
    },
  })

  runDurableKvConformance('RedisDurableKv (real cluster)', {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('kv')
      return { kv: new RedisDurableKv({ client, prefix }), teardown: () => cleanupPrefix(client, prefix) }
    },
  })

  runDurabilityConformance('RedisDurability (real cluster)', {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('dur')
      const backend = new RedisDurability({ client, prefix })
      await backend.start()
      return { backend, teardown: async () => { await backend.stop(); await cleanupPrefix(client, prefix) } }
    },
  })

  const deps = { Bot, MemoryStore, MockProvider, CrashableProvider, crashable, flow } as unknown as CrashMatrixDeps
  // A journal call the killed bot A had already sent keeps writing after the crash (on a
  // cluster the inbox and outbox sit on different connections, so it could land after B's
  // start-up reclaim and hold a fresh 60 s outbox lease). The matrix now waits for those
  // in-flight calls before it starts B, like a real restart, so it runs without retries.
  runCrashRecoveryMatrix('RedisDurability (real cluster)', deps, {
    async make() {
      const client = await sharedClient()
      const prefix = freshPrefix('crash')
      return { backend: new RedisDurability({ client, prefix }), teardown: () => cleanupPrefix(client, prefix) }
    },
  })
}

/** Wrap a coordinator so the test can wait until N reservations reached Redis (= ingress order). */
function counting(inner: Coordinator) {
  let count = 0
  const wrapped: Coordinator = {
    replicaId: inner.replicaId,
    start: () => inner.start(),
    stop: () => inner.stop(),
    acquireTurn: (t, o) => inner.acquireTurn(t, o),
    lead: (name, o) => inner.lead(name, o),
    tryLead: (name) => inner.tryLead(name),
    on: (e, l) => inner.on(e, l),
    reserve: async (key: string): Promise<Ticket> => { const t = await inner.reserve(key); count++; return t },
  }
  return { coordinator: wrapped, reserved: () => count }
}

describe.skipIf(!CLUSTER_URL)('Redis Cluster (real)', () => {
  let cluster: NodeRedisCluster
  let node: Awaited<ReturnType<typeof connectNode>>
  const cleanups: Array<() => Promise<unknown>> = []
  const children: ChildProcess[] = []
  const mine: string[] = []
  const prefix = (tag: string) => { const p = runPrefix(tag); mine.push(p); return p }

  beforeAll(async () => {
    node = await connectNode()
    await waitClusterOk(node)
    cluster = await connectCluster()
  })

  afterAll(async () => {
    for (const child of children) if (child.exitCode === null) child.kill()
    for (const c of cleanups.reverse()) await c().catch(() => {})
    for (const p of mine) await cleanupPrefix(cluster, p).catch(() => {})
    await cluster?.quit()
    await node?.quit()
  })

  /** One replica: its own cluster connections (store + coordinator) on the shared prefix. */
  function replica(p: string, id: string, opts: { leaseMs?: number; exclusive?: boolean } = {}) {
    const provider = new MockProvider({ exclusiveSession: opts.exclusive })
    const store = new RedisStore({ cluster: clusterOptions(), prefix: p })
    const inner = new RedisCoordinator({ cluster: clusterOptions(), prefix: p, replicaId: id, leaseMs: opts.leaseMs ?? 3_000, maxPollMs: 20 })
    const { coordinator, reserved } = counting(inner)
    const bot = new Bot({ provider, store, coordination: { coordinator } })
    cleanups.push(() => bot.stop())
    return { bot, provider, store, coordinator: inner, reserved }
  }

  for (const probe of CLUSTER_PROBES) {
    it(`probe: ${probe.name}`, async () => {
      const ns = prefix('probe')
      const actual = await probeOutcome(probe, asRedisLike(cluster), ns)
      const expected = probe.byClientMajor?.[REDIS_CLIENT_MAJOR as 'v4' | 'v5' | 'v6'] ?? probe.expected
      expect(probeMeets(actual, expected), JSON.stringify(actual)).toBe(true)
    })
  }

  it('every key the components write agrees with CLUSTER KEYSLOT, and the data spreads over several masters', async () => {
    const p = prefix('slots')
    const store = new RedisStore({ client: cluster, prefix: p })
    await store.start()
    for (let i = 0; i < 40; i++) {
      await store.upsertChat({ id: `c${i}` })
      await store.saveMessage(msg(`c${i}`, `m${i}`, i))
      await store.upsertContact({ id: `u${i}` })
      await store.setCheckpoint(`chat:c${i}`, { flowId: 'f', step: 0, state: {}, updatedAt: 1 })
      await store.setUserData({ userId: `u${i}`, namespace: 'n', key: 'k', value: i, updatedAt: 1 })
    }
    await store.acquireLockFenced('job')
    await store.schedules().register({ id: 'daily', kind: 'cron', spec: '0 9 * * *', nextRunAt: 1 }, 0)
    const coord = store.coordinator({ replicaId: 'r' })
    await coord.start()
    await (await coord.acquireTurn(await coord.reserve('chat-x'))).release()
    await (await coord.tryLead('session'))!.release()
    await coord.stop()
    const keys = await scanEverywhere(cluster, `${p}*`)
    expect(keys.length).toBeGreaterThan(200)
    for (const key of keys) expect(hashSlot(key)).toBe(await keySlot(node, key))
    const perMaster = await Promise.all(cluster.masters.map(async (m) => {
      const c = await cluster.nodeClient(m)
      let n = 0
      for await (const batch of c.scanIterator({ MATCH: `${p}*`, COUNT: 500 })) n += Array.isArray(batch) ? batch.length : 1
      return n
    }))
    expect(perMaster.filter((n) => n > 0).length).toBeGreaterThan(1)
    expect((await store.listChats()).length).toBe(40)
    expect((await store.listCheckpoints()).length).toBe(40)
    const co = coordKeys(p, 'cluster').turn('chat-x')
    expect(new Set(await Promise.all(Object.values(co).map((k) => keySlot(node, k)))).size).toBe(1)
  }, 60_000)

  it('own cluster clients of the coordinator and the durability backend survive killed connections', async () => {
    const p = prefix('kill')
    const errors: unknown[] = []
    const kv = new RedisDurableKv({ prefix: p, cluster: clusterOptions(), logger: { error: (o: unknown) => errors.push(o) } })
    const coord = new RedisCoordinator({ prefix: p, cluster: clusterOptions(), replicaId: 'k', logger: { warn: (o) => errors.push(o) } })
    await kv.start()
    await coord.start()
    cleanups.push(() => coord.stop(), () => kv.stop())
    expect(await kv.insert('t', 'a', 'v1', { due: 1, done: null })).toBeDefined()
    // Drop every ordinary connection on every master (a network blip / node restart).
    const seed = new URL(CLUSTER_URL!)
    for (const m of cluster.masters as Array<{ port: number }>) {
      const admin = await connectNode(`redis://${seed.hostname}:${m.port}`)
      await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes'])
      await admin.quit()
    }
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 10_000 })
    // Both reconnect and keep working (an unheard 'error' event used to crash the process).
    await vi.waitFor(async () => expect(await kv.get('t', 'a')).toMatchObject({ value: 'v1' }), { timeout: 10_000 })
    await vi.waitFor(async () => {
      const lead = await coord.tryLead('kill-check')
      expect(lead).not.toBeNull()
      await lead!.release()
    }, { timeout: 10_000 })
  }, 60_000)

  it('deleteChat removes thousands of messages and the chat record across slots', async () => {
    const p = prefix('del')
    const store = new RedisStore({ client: cluster, prefix: p })
    await store.start()
    await store.upsertChat({ id: 'big' })
    for (let i = 0; i < 2500; i += 250) {
      await Promise.all(Array.from({ length: 250 }, (_, j) => store.saveMessage(msg('big', `m${i + j}`, i + j))))
    }
    await Promise.all([store.deleteChat('big'), store.saveMessage(msg('big', 'late', 1e9))])
    expect(await store.getChat('big')).toBeUndefined()
    const left = await store.getMessagesByChat('big', 5000)
    expect(left.map((m) => m.ref.id).filter((id) => id !== 'late')).toEqual([])
    const items = await scanEverywhere(cluster, `${p}:{m:big}:i:*`)
    expect(items.length).toBe(left.length)
  }, 60_000)

  it('two replicas keep 200 interleaved messages of one chat in ingress order, never overlapping', async () => {
    const p = prefix('order')
    const a = replica(p, 'a')
    const b = replica(p, 'b')
    const log: Array<{ body: string; start: number; end: number }> = []
    for (const r of [a, b]) {
      r.bot.onMessage(async (ctx) => {
        const start = performance.now()
        await sleep(Math.floor(Math.random() * 10))
        log.push({ body: ctx.body, start, end: performance.now() })
      })
      await r.bot.start()
    }
    const N = 200
    for (let i = 0; i < N; i++) {
      const r = i % 2 === 0 ? a : b
      const before = r.reserved()
      r.provider.incoming(`m${i}`, { from: 'chat-1', id: `id-${i}` })
      await vi.waitFor(() => expect(r.reserved()).toBe(before + 1), { interval: 1, timeout: 5_000 })
    }
    await vi.waitFor(() => expect(log).toHaveLength(N), { timeout: 60_000, interval: 50 })
    expect(log.map((e) => e.body)).toEqual(Array.from({ length: N }, (_, i) => `m${i}`))
    for (let i = 1; i < N; i++) expect(log[i]!.start).toBeGreaterThanOrEqual(log[i - 1]!.end)
    expect(Number(await cluster.get(coordKeys(p, 'cluster').turn('chat-1').seq))).toBe(N)
  }, 90_000)

  it('fails over in-process (simulateCrash): the dead holder is probed and skipped', async () => {
    const p = prefix('crash')
    const leaseMs = 600
    const dying = new RedisCoordinator({ client: cluster, prefix: p, replicaId: 'dying', leaseMs })
    cleanups.push(() => dying.stop())
    await dying.start()
    const held = await dying.acquireTurn(await dying.reserve('chat-c'))
    await dying.reserve('chat-c')                  // a queued ticket of the replica about to die
    const b = replica(p, 'b', { leaseMs })
    const handled: string[] = []
    b.bot.onMessage(async (ctx) => { handled.push(ctx.body) })
    await b.bot.start()
    b.provider.incoming('next', { from: 'chat-c', id: 'c1' })
    await sleep(200)
    expect(handled).toEqual([])
    dying.simulateCrash()
    expect(held.signal.aborted).toBe(true)
    await vi.waitFor(() => expect(handled).toEqual(['next']), { timeout: leaseMs * 4, interval: 20 })
  }, 20_000)

  it.skipIf(!BUILT)('fails over when the replica holding a chat dies (child process killed)', async () => {
    const p = prefix('failover')
    const leaseMs = 1_000
    const child = spawn(process.execPath, [HOLDER, CLUSTER_URL!, p, 'chat-f', String(leaseMs)], { stdio: ['ignore', 'pipe', 'inherit'] })
    children.push(child)
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('held')) resolve() })
      child.once('exit', (code) => reject(new Error(`holder exited early (${code})`)))
    })
    const b = replica(p, 'b', { leaseMs })
    const handled: string[] = []
    b.bot.onMessage(async (ctx) => { handled.push(ctx.body) })
    await b.bot.start()
    b.provider.incoming('waiting', { from: 'chat-f', id: 'f1' })
    await sleep(300)
    expect(handled).toEqual([])
    const killedAt = performance.now()
    child.kill('SIGKILL')
    await vi.waitFor(() => expect(handled).toEqual(['waiting']), { timeout: leaseMs * 4, interval: 20 })
    expect(performance.now() - killedAt).toBeLessThan(leaseMs * 1.5 + 1000)
  }, 30_000)

  it('runs an exclusive-session provider on one replica and hands it over with a larger term', async () => {
    const p = prefix('lead')
    const leaseMs = 800
    const a = replica(p, 'a', { leaseMs, exclusive: true })
    const b = replica(p, 'b', { leaseMs, exclusive: true })
    await a.bot.start()
    await vi.waitFor(() => expect(a.provider.starts).toBe(1))
    await b.bot.start()
    await sleep(leaseMs)
    expect(b.provider.starts).toBe(0)
    await a.bot.stop()
    await vi.waitFor(() => expect(b.provider.starts).toBe(1), { timeout: leaseMs * 3 })
    expect(Number(await cluster.get(coordKeys(p, 'cluster').lead('provider:mock').term))).toBe(2)
  }, 20_000)

  it('a persistent flow started on one replica continues on the other through the shared store', async () => {
    const p = prefix('flow')
    const make = (id: string) => {
      const r = replica(p, id)
      r.bot.use(flow('signup').persistent().say('hi').ask('name?', 'name').ask('email?', 'email')
        .say((_ctx, c) => `done ${String(c.state.name)} ${String(c.state.email)}`))
      return r
    }
    const a = make('a')
    const b = make('b')
    await a.bot.start(); await b.bot.start()
    a.provider.incoming('signup', { from: 'chat-p', id: 'p1' })
    await vi.waitFor(() => expect(texts(a.provider)).toEqual(['hi', 'name?']))
    b.provider.incoming('Ana', { from: 'chat-p', id: 'p2' })
    await vi.waitFor(() => expect(texts(b.provider)).toEqual(['email?']))
    a.provider.incoming('ana@x.co', { from: 'chat-p', id: 'p3' })
    await vi.waitFor(() => expect(texts(a.provider)).toEqual(['hi', 'name?', 'done Ana ana@x.co']))
    const reader = new RedisStore({ client: cluster, prefix: p })
    await vi.waitFor(async () => expect(await reader.listCheckpoints()).toEqual([]))
  }, 20_000)
})
