/**
 * Real Redis Cluster helpers for the opt-in integration suites (no-ops without
 * BOTWA_TEST_REDIS_CLUSTER_URL). Start a local cluster (see CONTRIBUTING):
 *
 *   docker run -d --name botmesh-it-redis-cluster -e IP=0.0.0.0 -e INITIAL_PORT=47100 \
 *     -e MASTERS=3 -e SLAVES_PER_MASTER=1 -p 127.0.0.1:47100-47105:47100-47105 grokzen/redis-cluster:7.0.10
 *   BOTWA_TEST_REDIS_CLUSTER_URL=redis://127.0.0.1:47100 pnpm --filter @botmesh/redis-store test
 *
 * Every address the cluster announces is mapped to the seed's host (Docker port
 * mapping), keeping the announced port. Cleanup scans every master and deletes key by
 * key (a multi-key DEL would cross slots).
 */
import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import {
  createOwnRedisClient, type RedisClusterConnectOptions,
} from '../src/client.js'
import { scanEverywhere } from '../src/migrate.js'
import { escapeGlob } from '../src/glob.js'
import type { NodeRedisClient, NodeRedisCluster } from './nodeRedis.js'

export const CLUSTER_URL = process.env.BOTWA_TEST_REDIS_CLUSTER_URL
export const CHAOS = process.env.BOTWA_TEST_REDIS_CLUSTER_CHAOS === '1'

/**
 * Every node of `CLUSTER NODES` output as a root-node URL on the seed's host (Docker port
 * mapping), seed first. Nodes without an address are skipped; unparseable output gives
 * just the seed.
 */
export function rootNodesFromClusterNodes(output: string, seedUrl: string): string[] {
  const seed = new URL(seedUrl)
  const urls = [seedUrl]
  for (const line of output.split(/\r?\n/)) {
    const address = line.split(' ')[1]?.split('@')[0]
    const port = Number(address?.slice(address.lastIndexOf(':') + 1))
    if (!Number.isInteger(port) || port <= 0) continue
    const url = `redis://${seed.hostname}:${port}`
    if (!urls.includes(url) && Number(seed.port) !== port) urls.push(url)
  }
  return urls
}

/**
 * The root nodes of the test cluster: every node, so node-redis's initial slot discovery
 * tries another node when one is unreachable or slow (a failover in flight, a loaded
 * machine), instead of failing with "All the root nodes are unavailable".
 */
const ROOT_NODES: string[] = CLUSTER_URL ? await discoverRootNodes(CLUSTER_URL) : []

async function discoverRootNodes(url: string): Promise<string[]> {
  try {
    const node = await connectNode(url)
    try { return rootNodesFromClusterNodes(String(await node.sendCommand(['CLUSTER', 'NODES'])), url) } finally { await node.quit() }
  } catch {
    return [url]
  }
}

export function clusterOptions(url = CLUSTER_URL!): RedisClusterConnectOptions {
  const seed = new URL(url)
  return {
    rootNodes: url === CLUSTER_URL && ROOT_NODES.length ? [...ROOT_NODES] : [url],
    nodeAddressMap: (address: string) => ({ host: seed.hostname, port: Number(address.slice(address.lastIndexOf(':') + 1)) }),
  }
}

/**
 * Connect a fresh client from `make()`, retrying a failed initial connect (`attempts` in
 * all; `between(n)` runs before retry n). node-redis does not retry a failed initial
 * cluster discovery, and a cluster client can be reconnected after one, but a fresh client
 * is used per attempt to start from a clean state.
 */
export async function connectWithRetry<T extends { connect(): Promise<unknown> }>(
  make: () => T,
  { attempts = 4, between = defaultBetween }: { attempts?: number; between?: (retry: number) => Promise<void> } = {},
): Promise<T> {
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await between(attempt - 1)
    const client = make()
    try {
      await client.connect()
      return client
    } catch (err) {
      last = err
      await (client as { destroy?: () => unknown }).destroy?.()
    }
  }
  throw last
}

/** Before a retry: wait for `cluster_state:ok` (best effort) and back off a little. */
async function defaultBetween(retry: number): Promise<void> {
  try {
    const node = await connectNode()
    try { await waitClusterOk(node, 10_000) } finally { await node.quit() }
  } catch { /* the next attempt reports the failure */ }
  await new Promise((r) => setTimeout(r, 250 * retry))
}

/** A connected cluster client (caller closes it). Retries a failed initial discovery. */
export async function connectCluster(url = CLUSTER_URL!): Promise<NodeRedisCluster> {
  return connectWithRetry(() => createOwnRedisClient({ cluster: clusterOptions(url), onError: () => {} }) as unknown as NodeRedisCluster)
}

/** A plain connection to one node (the seed by default), for CLUSTER commands. */
export async function connectNode(url = CLUSTER_URL!): Promise<NodeRedisClient> {
  const node = createClient({ url })
  node.on('error', () => {})
  await node.connect()
  return node
}

/** Wait until the cluster reports `cluster_state:ok`. */
export async function waitClusterOk(node: NodeRedisClient, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const info = String(await node.sendCommand(['CLUSTER', 'INFO']))
    if (info.includes('cluster_state:ok')) return
    if (Date.now() > until) throw new Error(`Redis Cluster not ready: ${info.split('\n')[0]}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

export async function keySlot(node: NodeRedisClient, key: string): Promise<number> {
  return Number(await node.sendCommand(['CLUSTER', 'KEYSLOT', key]))
}

/** A unique prefix for one run (no braces: the cluster layout rejects them). */
export function runPrefix(tag: string): string {
  return `botwa-cit-${process.pid}-${randomUUID().slice(0, 8)}-${tag}`
}

/** Delete every key of a prefix on every master, one key at a time. */
export async function cleanupPrefix(cluster: NodeRedisCluster, prefix: string): Promise<void> {
  const keys = await scanEverywhere(cluster, `${escapeGlob(prefix)}*`)
  for (const key of keys) await cluster.del(key)
}
