/**
 * Guards for the real-server suites' isolation (no server needed): the chaos suite runs
 * in a later vitest group than every other file, cluster clients of the suites retry a
 * failed initial discovery, and BOTWA_TEST_REDIS_CLIENT really selects the node-redis major.
 */
import { describe, it, expect } from 'vitest'
import config from '../vitest.config.js'
import { connectWithRetry, rootNodesFromClusterNodes } from './clusterEnv.js'
import { REDIS_CLIENT_MAJOR } from './nodeRedis.js'

type Project = { test?: { name?: string; include?: string[]; exclude?: string[]; sequence?: { groupOrder?: number } } }

describe('real-server suite isolation', () => {
  it('runs the cluster chaos file alone, in a group after every other file', () => {
    const projects = (config as { test?: { projects?: Project[] } }).test?.projects ?? []
    const chaos = projects.find((p) => p.test?.include?.some((g) => g.includes('cluster-chaos')))
    const rest = projects.filter((p) => p !== chaos)
    expect(chaos).toBeDefined()
    expect(rest.length).toBeGreaterThan(0)
    for (const p of rest) {
      expect(p.test?.exclude?.some((g) => g.includes('cluster-chaos'))).toBe(true)
      expect(chaos!.test!.sequence!.groupOrder!).toBeGreaterThan(p.test?.sequence?.groupOrder ?? 0)
    }
  })

  it('seeds cluster discovery with every node CLUSTER NODES lists (not only the seed)', () => {
    const nodes = [
      'a1 127.0.0.1:47400@57400 myself,master - 0 0 1 connected 0-5460',
      'b2 127.0.0.1:47401@57401 master - 0 1 2 connected 5461-10922',
      'c3 0.0.0.0:47405@57405 slave b2 0 1 2 connected',
      'd4 :0@0 master,noaddr - 0 1 2 disconnected',
      '',
    ].join('\n')
    expect(rootNodesFromClusterNodes(nodes, 'redis://127.0.0.1:47400')).toEqual([
      'redis://127.0.0.1:47400', 'redis://127.0.0.1:47401', 'redis://127.0.0.1:47405',
    ])
    expect(rootNodesFromClusterNodes('garbage', 'redis://127.0.0.1:47400')).toEqual(['redis://127.0.0.1:47400'])
  })

  it('connectWithRetry retries a failed initial connect, then gives up with the last error', async () => {
    let made = 0
    const waits: number[] = []
    const client = await connectWithRetry(() => {
      made++
      return { connect: async () => { if (made < 3) throw new Error('All the root nodes are unavailable') } }
    }, { attempts: 4, between: async (n) => { waits.push(n) } })
    expect(made).toBe(3)
    expect(waits).toEqual([1, 2])
    expect(client).toBeDefined()

    let tries = 0
    await expect(connectWithRetry(() => ({ connect: async () => { tries++; throw new Error(`down ${tries}`) } }), { attempts: 2, between: async () => {} }))
      .rejects.toThrow('down 2')
  })

  it('BOTWA_TEST_REDIS_CLIENT selects the node-redis major the suites import', async () => {
    const loaded = await import('redis')
    const expected = REDIS_CLIENT_MAJOR === 'v4' ? await import('redis-v4') : REDIS_CLIENT_MAJOR === 'v5' ? await import('redis-v5') : undefined
    if (expected) expect(loaded).toBe(expected)
    else {
      expect(loaded).not.toBe(await import('redis-v4'))
      expect(loaded).not.toBe(await import('redis-v5'))
    }
  })
})
