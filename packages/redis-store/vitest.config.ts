import { defineConfig } from 'vitest/config'

/**
 * BOTWA_TEST_REDIS_CLIENT=v4|v5 runs every suite with that node-redis major: `redis` is
 * aliased to the `redis-v4` / `redis-v5` devDependency for the tests AND the store's own
 * clients. Without it the suites use the `redis` devDependency (the current major, 6).
 *
 * The cluster chaos file (failover, slot migration) changes the shared cluster's
 * topology: it runs in its own project, in a later group (`sequence.groupOrder`), once
 * every other file has finished, so no suite opens a cluster client mid-failover.
 */
const major = process.env.BOTWA_TEST_REDIS_CLIENT
const target = major === 'v4' ? 'redis-v4' : major === 'v5' ? 'redis-v5' : undefined
if (major && !target && major !== 'v6') throw new Error(`BOTWA_TEST_REDIS_CLIENT must be v4, v5 or v6 (got ${major})`)

const CHAOS_FILE = 'tests/cluster-chaos.integration.test.ts'

export default defineConfig({
  resolve: { alias: target ? [{ find: /^redis$/, replacement: target }] : [] },
  test: {
    testTimeout: 10_000,
    projects: [
      {
        extends: true,
        test: { name: 'redis-store', include: ['tests/**/*.test.ts'], exclude: [CHAOS_FILE, '**/node_modules/**'], sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        test: { name: 'redis-store-chaos', include: [CHAOS_FILE], sequence: { groupOrder: 1 } },
      },
    ],
  },
})
