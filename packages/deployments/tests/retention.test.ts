/** DeploymentRegistry({ retainVersions }) bounds the versions kept per bot. */
import { describe, expect, it } from 'vitest'
import { DeploymentRegistry, MemoryDeploymentStore } from '../src/index.js'

describe('DeploymentRegistry retainVersions', () => {
  it('prunes after each publish, keeping the newest N and the active one', async () => {
    const registry = new DeploymentRegistry(new MemoryDeploymentStore(), { retainVersions: 3 })
    for (const v of ['1', '2', '3', '4', '5']) await registry.publish('t', 'b', v, `a${v}`)
    expect((await registry.list('t', 'b')).map((d) => d.version)).toEqual(['3', '4', '5'])
    await registry.rollback('t', 'b', '3')
    await registry.publish('t', 'b', '6', 'a6')
    await registry.rollback('t', 'b', '4')
    await registry.publish('t', 'b', '7', 'a7')
    expect((await registry.list('t', 'b')).map((d) => d.version)).toEqual(['5', '6', '7'])
  })

  it('rejects an invalid retainVersions', () => {
    expect(() => new DeploymentRegistry(undefined, { retainVersions: 0 })).toThrow(RangeError)
  })
})
