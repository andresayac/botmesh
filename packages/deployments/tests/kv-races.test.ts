/**
 * KvDeploymentStore under interleavings the single-threaded suites never produce: a
 * reservation that expires while its commit is writing, and a write that fails after
 * the version document is stored.
 */
import { describe, expect, it } from 'vitest'
import { MemoryKv, type DurableKv } from '@botmesh/core'
import { DeploymentExistsError, DeploymentRegistry, KvDeploymentStore } from '../src/index.js'

type Hook = (method: string, table: string, id: string, value: string) => Promise<void> | void

/** A MemoryKv whose writes (insert/replace/remove) first run `hook`. */
function hookedKv(hook: { fn?: Hook }): DurableKv {
  const kv = new MemoryKv()
  return new Proxy(kv, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function') return value
      if (prop === 'insert' || prop === 'replace' || prop === 'remove') {
        return async (...args: unknown[]) => {
          await hook.fn?.(String(prop), String(args[0]), String(args[1]), String(prop === 'insert' ? args[2] : prop === 'replace' ? args[3] : ''))
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(target)
    },
  }) as DurableKv
}

const isVersionTable = (table: string) => table.includes('deployments/version')
const isBotTable = (table: string) => table.includes('deployments/bot')

describe('KvDeploymentStore commit races', () => {
  it('a gated commit whose reservation expired mid-write never replaces the artifact of the publish that won', async () => {
    let now = 1_000
    const clock = () => now
    const hook: { fn?: Hook } = {}
    const store = new KvDeploymentStore(hookedKv(hook), { clock })
    const a = new DeploymentRegistry(store, { clock, gateTimeoutMs: 100 })
    const b = new DeploymentRegistry(store, { clock })

    let raced = false
    hook.fn = async (_method, table) => {
      if (raced || !isVersionTable(table)) return
      raced = true
      now += 1_000 // A's reservation expires while it writes its version document
      await expect(b.publish('acme', 'bot', '1.0.0', 'sha:B')).resolves.toMatchObject({ artifact: 'sha:B' })
    }
    const gate = () => { now += 100; return { ok: true } } // passes exactly at the expiry
    await expect(a.publish('acme', 'bot', '1.0.0', 'sha:A', { gate })).rejects.toBeInstanceOf(DeploymentExistsError)
    expect(raced).toBe(true)
    expect((await store.get('acme', 'bot', '1.0.0'))?.artifact).toBe('sha:B')
    expect((await store.active('acme', 'bot'))?.artifact).toBe('sha:B')
    expect((await store.list('acme', 'bot')).map((d) => d.artifact)).toEqual(['sha:B'])
  })

  it('a plain commit that is slow to write never replaces the artifact of a concurrent one that won', async () => {
    const hook: { fn?: Hook } = {}
    const store = new KvDeploymentStore(hookedKv(hook))
    let raced = false
    let b: unknown
    hook.fn = async (_method, table) => {
      if (raced || !isVersionTable(table)) return
      raced = true
      b = await store.commit({ tenantId: 'acme', botId: 'bot', version: '1.0.0', artifact: 'sha:B' }).catch((e: unknown) => e)
    }
    const a = await store.commit({ tenantId: 'acme', botId: 'bot', version: '1.0.0', artifact: 'sha:A' }).catch((e: unknown) => e)
    expect(raced).toBe(true)
    // Exactly one wins, the other is refused, and the stored artifact is the winner's.
    const outcomes = [a, b]
    expect(outcomes.filter((o) => o instanceof DeploymentExistsError)).toHaveLength(1)
    const winner = outcomes.find((o) => !(o instanceof Error)) as { artifact: string }
    expect((await store.get('acme', 'bot', '1.0.0'))?.artifact).toBe(winner.artifact)
  })

  it('a reserved commit is refused while another publish holds a live reservation of the version', async () => {
    let now = 1_000
    const clock = () => now
    const store = new KvDeploymentStore(new MemoryKv(), { clock })
    expect(await store.reserve('acme', 'bot', '1.0.0', 1_100)).toBe(true)
    now = 1_200 // expired: someone else reserves it
    expect(await store.reserve('acme', 'bot', '1.0.0', 2_000)).toBe(true)
    await expect(store.commit({ tenantId: 'acme', botId: 'bot', version: '1.0.0', artifact: 'sha:A', reserved: true, reservedUntil: 1_100 }))
      .rejects.toBeInstanceOf(DeploymentExistsError)
    await expect(store.commit({ tenantId: 'acme', botId: 'bot', version: '1.0.0', artifact: 'sha:B', reserved: true, reservedUntil: 2_000 }))
      .resolves.toMatchObject({ artifact: 'sha:B', active: true })
  })

  it('a plain publish that fails on the bot document can be retried at once', async () => {
    const hook: { fn?: Hook } = {}
    const store = new KvDeploymentStore(hookedKv(hook))
    const registry = new DeploymentRegistry(store)
    let failed = false
    hook.fn = (_method, table, _id, value) => {
      // Fail the write that adds the version to the bot document (not a reservation).
      if (failed || !isBotTable(table) || !value.includes('"versions":["1.0.0"]')) return
      failed = true
      throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    }
    await expect(registry.publish('acme', 'bot', '1.0.0', 'sha:A')).rejects.toThrow('ECONNRESET')
    expect(await store.get('acme', 'bot', '1.0.0')).toBeUndefined()
    await expect(registry.publish('acme', 'bot', '1.0.0', 'sha:A')).resolves.toMatchObject({ artifact: 'sha:A', active: true })
  })

  it('reads versions committed by the previous layout (version document keyed by version)', async () => {
    const kv = new MemoryKv()
    const legacyBot = { activeVersion: '0.9.0', versions: ['0.9.0'], pending: {}, updatedAt: 1 }
    const legacyVersion = { artifact: 'sha:old', createdAt: 1 }
    await kv.insert('product/deployments/bot/acme', 'bot', JSON.stringify(legacyBot), { due: -1, done: null })
    await kv.insert('product/deployments/version/acme/bot', '0.9.0', JSON.stringify(legacyVersion), { due: 1, done: null })
    const store = new KvDeploymentStore(kv)
    expect(await store.get('acme', 'bot', '0.9.0')).toMatchObject({ artifact: 'sha:old', active: true })
    await store.commit({ tenantId: 'acme', botId: 'bot', version: '1.0.0', artifact: 'sha:new' })
    expect((await store.list('acme', 'bot')).map((d) => [d.version, d.artifact])).toEqual([['0.9.0', 'sha:old'], ['1.0.0', 'sha:new']])
    await store.activate('acme', 'bot', '0.9.0')
    expect((await store.active('acme', 'bot'))?.artifact).toBe('sha:old')
  })
})
