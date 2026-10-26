/**
 * Checkpoint compare-and-set must not depend on the server's cjson being able to decode
 * the stored checkpoint. `c.state` is user data: a message body cut in the middle of an
 * emoji leaves a lone UTF-16 surrogate, which JSON.stringify escapes (`\ud83d`) and
 * Redis' cjson refuses to decode — the revision then read as 0, so every later
 * `setCheckpointIf`/`clearCheckpointIf` of that conversation was refused.
 *
 * Runs on the hermetic fakes (which model cjson's refusal) and, when the env vars are
 * set, on a real Redis (`BOTWA_TEST_REDIS_URL`) and a real cluster (`BOTWA_TEST_REDIS_CLUSTER_URL`).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import type { FlowCheckpoint } from '@botmesh/core'
import { RedisStore } from '../src/RedisStore.js'
import { FakeRedisClient } from './fakeRedis.js'
import { ClusterFakeRedisClient } from './fakeClusterRedis.js'
import { CLUSTER_URL, cleanupPrefix, connectCluster } from './clusterEnv.js'

const REDIS_URL = process.env.BOTWA_TEST_REDIS_URL
const RUN = `botwa-it:${process.pid}-${randomUUID().slice(0, 8)}:cas-json`
const cleanups: Array<() => Promise<void>> = []
afterAll(async () => { for (const c of cleanups) await c().catch(() => {}) })

interface Variant { label: string; skip?: boolean; make(): Promise<RedisStore> }

const variants: Variant[] = [
  { label: 'fake, legacy layout', make: async () => new RedisStore({ client: new FakeRedisClient() }) },
  { label: 'fake, cluster layout', make: async () => new RedisStore({ client: new ClusterFakeRedisClient() }) },
  { label: 'fake, legacy layout, sessionTtl', make: async () => new RedisStore({ client: new FakeRedisClient(), sessionTtl: '1h' }) },
  {
    label: 'real server',
    skip: !REDIS_URL,
    async make() {
      const client = createClient({ url: REDIS_URL })
      client.on('error', () => {})
      await client.connect()
      const prefix = `${RUN}:${randomUUID().slice(0, 8)}`
      cleanups.push(async () => {
        const keys = await client.keys(`${prefix}*`)
        if (keys.length) await client.del(keys)
        await client.quit()
      })
      return new RedisStore({ client, prefix, sessionTtl: '1h' })
    },
  },
  {
    label: 'real cluster',
    skip: !CLUSTER_URL,
    async make() {
      const client = await connectCluster()
      const prefix = `${RUN}:${randomUUID().slice(0, 8)}`
      cleanups.push(async () => { await cleanupPrefix(client, prefix); await client.quit() })
      return new RedisStore({ client, prefix })
    },
  },
]

const cp = (revision: number, state: Record<string, unknown>): FlowCheckpoint => ({
  flowId: 'reg', step: revision, state, updatedAt: revision, revision,
})

/** What a WhatsApp body sliced mid-emoji looks like. */
const CUT = '😀😀'.slice(0, 3)

for (const v of variants) {
  describe.skipIf(v.skip)(`checkpoint CAS over undecodable JSON (${v.label})`, () => {
    it('replaces a checkpoint whose state holds a lone surrogate, and refuses a stale revision', async () => {
      const store = await v.make()
      await store.start()
      expect(await store.setCheckpointIf('k', cp(1, { name: CUT }), 0)).toBe(true)
      expect(await store.setCheckpointIf('k', cp(2, { name: 'x' }), 0)).toBe(false) // stale: revision 1 is stored
      expect(await store.setCheckpointIf('k', cp(2, { name: CUT }), 1)).toBe(true)
      expect((await store.getCheckpoint('k'))?.revision).toBe(2)
      expect(await store.setCheckpointIf('k', cp(3, { name: 'ok' }), 2)).toBe(true)
      expect((await store.getCheckpoint('k'))?.state).toEqual({ name: 'ok' })
    })

    it('clears it only with the right revision', async () => {
      const store = await v.make()
      await store.start()
      expect(await store.setCheckpointIf('c', cp(1, { name: CUT }), 0)).toBe(true)
      expect(await store.clearCheckpointIf('c', 0)).toBe(false)
      expect(await store.getCheckpoint('c')).toBeDefined()
      expect(await store.clearCheckpointIf('c', 1)).toBe(true)
      expect(await store.getCheckpoint('c')).toBeUndefined()
    })

    it('a plain setCheckpoint row (no revision) with a lone surrogate counts as revision 0', async () => {
      const store = await v.make()
      await store.start()
      await store.setCheckpoint('p', { flowId: 'reg', step: 1, state: { name: CUT }, updatedAt: 1 })
      expect(await store.setCheckpointIf('p', cp(1, { name: 'y' }), 1)).toBe(false)
      expect(await store.setCheckpointIf('p', cp(1, { name: 'y' }), 0)).toBe(true)
      expect(await store.listCheckpoints()).toHaveLength(1)
    })
  })
}
