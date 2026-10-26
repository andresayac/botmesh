/**
 * Model-based test: random install / enable / disable / list sequences (valid and hostile
 * manifests, missing grants, unknown plugins) through PluginRegistry over
 * MemoryPluginStore (the reference) and KvPluginStore: same outcome, same final state, and
 * an enabled plugin always has every declared permission granted.
 */
import { describe, expect, it } from 'vitest'
import { MemoryKv } from '@botmesh/core'
import { KvPluginStore, MemoryPluginStore, PLUGIN_PERMISSIONS, PluginRegistry, type PluginPermission } from '../src/index.js'
import { outcome, rng } from '../../../test-utils/prng.js'

const TENANTS = ['acme', 'globex', 'a/b']
const IDS = ['crm-sync', 'ai-helper', 'x']
const RANGES = ['^2.0.0', '>=2.1.0 <3.0.0', '1.x', '*', '^2.0.0 || ^3.0.0', 'v2', 2]
const ENTRIES = ['dist/index.js', '../escape.js', 'C:/x.js', 'a..b.js', '/abs.js']

describe('PluginRegistry model: KvPluginStore behaves like MemoryPluginStore', () => {
  for (const seed of [21, 22, 23, 24, 25, 26]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed)
      let now = 1_000
      const clock = () => now
      const registries = [
        new PluginRegistry(new MemoryPluginStore(), { clock }),
        new PluginRegistry(new KvPluginStore(new MemoryKv()), { clock }),
      ]
      for (let step = 0; step < 300; step++) {
        now += 1 + r.int(3)
        const tenantId = r.pick(TENANTS)
        const id = r.pick(IDS)
        const op = r.int(5)
        const permissions = Array.from({ length: r.int(3) }, () => r.chance(0.95) ? r.pick(PLUGIN_PERMISSIONS) : 'root:all')
        let call: (registry: PluginRegistry) => Promise<unknown>
        if (op === 0) {
          const manifest = { id, version: r.pick(['1.0.0', '2.3.4-beta.1', '01.0.0']), botwa: r.pick(RANGES), entry: r.pick(ENTRIES), permissions, ...(r.chance(0.2) ? { name: r.pick(['CRM', 7]) } : {}) }
          const runtime = r.pick(['2.0.0', '2.5.0', '3.0.0'])
          call = (registry) => registry.install(tenantId, manifest as never, runtime)
        } else if (op === 1) {
          call = (registry) => registry.enable(tenantId, id, permissions as PluginPermission[])
        } else if (op === 2) {
          call = (registry) => registry.disable(tenantId, id)
        } else if (op === 3) {
          const limit = r.pick([1, 100])
          call = (registry) => registry.list(tenantId, { limit })
        } else {
          call = (registry) => registry.get(tenantId, id)
        }
        const results = []
        for (const registry of registries) results.push(await outcome(() => call(registry)))
        expect(results[1], `seed ${seed} step ${step} op ${op}`).toEqual(results[0])
      }
      for (const tenantId of TENANTS) {
        const listed = await registries[1]!.list(tenantId)
        expect(listed).toEqual(await registries[0]!.list(tenantId))
        for (const plugin of listed) expect(plugin.manifest.permissions.every((p) => PLUGIN_PERMISSIONS.includes(p))).toBe(true)
      }
    })
  }
})
