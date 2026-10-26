/**
 * Model-based test: random publish (plain, passing gate, failing gate, throwing gate),
 * rollback, get, list, active and gateRuns sequences against MemoryDeploymentStore (the
 * reference) and KvDeploymentStore: same outcome, same final state, and the invariants
 * hold: exactly one active version once anything is published, versions are immutable.
 */
import { describe, expect, it } from 'vitest'
import { MemoryKv } from '@botmesh/core/spi'
import { DeploymentRegistry, KvDeploymentStore, MemoryDeploymentStore, type GateRun } from '../src/index.js'
import { outcome, rng } from '../../../test-utils/prng.js'

const TENANTS = ['acme', 'a/b']
const BOTS = ['support', 'ventas 🦜']
const VERSIONS = ['1.0.0', '1.1.0', '2.0.0', 'v:{x}', '']

/** Gate runs without their random ids (and the trace's run id). */
const stripRun = ({ id: _id, ...run }: GateRun) => run
const stripDeployment = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripDeployment)
  if (value && typeof value === 'object' && 'gate' in value) {
    const { gate, ...rest } = value as { gate?: { runId?: string } }
    const { runId: _runId, ...trace } = gate ?? {}
    return { ...rest, gate: trace }
  }
  return value
}

describe('DeploymentRegistry model: KvDeploymentStore behaves like MemoryDeploymentStore', () => {
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed)
      let now = 1_700_000_000_000
      const clock = () => now
      const registries = [
        new DeploymentRegistry(new MemoryDeploymentStore({ clock }), { clock }),
        new DeploymentRegistry(new KvDeploymentStore(new MemoryKv(), { clock }), { clock }),
      ]
      const artifacts = new Map<string, string>()
      for (let step = 0; step < 250; step++) {
        now += 1 + r.int(3)
        const tenantId = r.pick(TENANTS)
        const botId = r.pick(BOTS)
        const version = r.pick(VERSIONS)
        const op = r.int(6)
        let call: (registry: DeploymentRegistry) => Promise<unknown>
        if (op <= 1) {
          const artifact = `sha256:${step}`
          const kind = r.int(4)
          const gate = kind === 0 ? undefined
            : kind === 1 ? () => ({ ok: true, summary: 'ok', details: { n: step, text: 'ñ🦜' } })
            : kind === 2 ? () => ({ ok: false, reason: 'golden diff' })
            : () => { throw new Error('gate crashed') }
          call = async (registry) => {
            const deployment = await registry.publish(tenantId, botId, version, artifact, gate ? { gate } : {})
            return stripDeployment(deployment)
          }
        } else if (op === 2) {
          call = async (registry) => stripDeployment(await registry.rollback(tenantId, botId, version))
        } else if (op === 3) {
          call = async (registry) => stripDeployment(await registry.list(tenantId, botId))
        } else if (op === 4) {
          call = async (registry) => stripDeployment(await registry.active(tenantId, botId))
        } else {
          call = async (registry) => (await registry.gateRuns(tenantId, botId, version)).map(stripRun)
        }
        const results = []
        for (const registry of registries) results.push(await outcome(() => call(registry)))
        expect(results[1], `seed ${seed} step ${step} op ${op}`).toEqual(results[0])
        // Versions are immutable: the first artifact stored for a version stays its artifact.
        const result = results[0] as { ok?: { version?: string; artifact?: string } }
        if (op <= 1 && result.ok?.artifact) {
          const key = `${tenantId}\u0000${botId}\u0000${version}`
          expect(artifacts.has(key)).toBe(false)
          artifacts.set(key, result.ok.artifact)
        }
      }
      for (const tenantId of TENANTS) {
        for (const botId of BOTS) {
          const [a, b] = await Promise.all(registries.map((registry) => registry.list(tenantId, botId)))
          expect(stripDeployment(b)).toEqual(stripDeployment(a))
          if (a!.length) expect(a!.filter((d) => d.active)).toHaveLength(1)
          for (const d of a!) expect(d.artifact).toBe(artifacts.get(`${tenantId}\u0000${botId}\u0000${d.version}`))
        }
      }
    })
  }
})
