/**
 * The README examples, run as written with the in-memory fakes in place of a server
 * (MockProvider in place of a real transport). The `url` forms run against a real Redis
 * when `BOTWA_TEST_REDIS_URL` is set.
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Bot } from '@botmesh/core'
import { MockProvider, createTestBot } from '@botmesh/core/testing'
import { RedisStore } from '../src/index.js'
import { FakeRedisClient } from './fakeRedis.js'
import { ClusterFakeRedisClient } from './fakeClusterRedis.js'

const REDIS_URL = process.env.BOTWA_TEST_REDIS_URL

describe('README examples (fake client)', () => {
  it('Injecting an existing client: the store never connects or quits it', async () => {
    const fake = new FakeRedisClient()
    const store = new RedisStore({ client: fake })
    const { bot, chat } = await createTestBot({ store })
    bot.when('hi', (ctx) => ctx.reply('hello'))
    await chat.send('hi')
    await chat.expectReply('hello')
    await bot.stop()
    expect((await store.listChats()).length).toBe(1) // the injected client is still usable
  })

  it('Running N replicas: store.coordinator() serves BotConfig.coordination', async () => {
    const store = new RedisStore({ client: new FakeRedisClient(), prefix: 'mybot' })
    const bot = new Bot({ provider: new MockProvider(), store, coordination: { coordinator: store.coordinator({ leaseMs: '15s' }) } })
    await bot.start()
    await bot.stop()
  })

  it('Distributed lock: acquireLockFenced / renewLock / releaseLock', async () => {
    const store = new RedisStore({ client: new FakeRedisClient() })
    const day = '2026-10-25'
    const fences: number[] = []
    const writeReport = async (_day: string, opts: { fence: number }) => { fences.push(opts.fence) }
    for (let i = 0; i < 2; i++) {
      const lock = await store.acquireLockFenced(`report:${day}`, 30_000)
      if (!lock) throw new Error('lock held')
      try {
        expect(await store.acquireLockFenced(`report:${day}`, 30_000)).toBeNull()
        await writeReport(day, { fence: lock.fence })
        expect(await store.renewLock(`report:${day}`, lock.token, 30_000)).toBe(true)
      } finally {
        expect(await store.releaseLock(`report:${day}`, lock.token)).toBe(true)
      }
    }
    expect(fences).toEqual([1, 2])
  })

  it('Durable scheduler tasks: schedules() + leases()', async () => {
    const store = new RedisStore({ client: new FakeRedisClient() })
    const bot = new Bot({ provider: new MockProvider(), store, scheduler: { store: store.schedules(), lease: store.leases() } })
    bot.every('15m', { id: 'sync-crm', missed: 'run-once' }, async (run) => { void run.occurrenceKey })
    await bot.start()
    const [record] = await store.schedules().list()
    expect(record?.id).toMatch(/sync-crm$/)
    await bot.stop()
  })

  it('Redis Cluster: a cluster client selects the cluster layout', async () => {
    const store = new RedisStore({ client: new ClusterFakeRedisClient(), prefix: 'mybot' })
    expect(store.layout).toBe('cluster')
    await store.start()
    await store.upsertChat({ id: 'c', name: 'n' })
    expect(await store.listChats()).toEqual([{ id: 'c', name: 'n' }])
  })
})

describe.skipIf(!REDIS_URL)('README examples (real server)', () => {
  it('Usage with Bot: url + prefix + sessionTtl, store.start() before the bot', async () => {
    const prefix = `botwa-it:docs-${randomUUID().slice(0, 8)}`
    const store = new RedisStore({ url: REDIS_URL, prefix, sessionTtl: '7d' })
    await store.start()
    const bot = new Bot({ provider: new MockProvider(), store })
    await bot.start() // starts the store again: idempotent
    await store.setCheckpoint('k', { flowId: 'f', step: 1, state: {}, updatedAt: 1 })
    await store.clearCheckpoint('k')
    await bot.stop()
  })
})
