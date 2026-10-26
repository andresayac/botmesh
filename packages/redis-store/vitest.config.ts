import { defineConfig } from 'vitest/config'

/**
 * BOTWA_TEST_REDIS_CLIENT=v4|v5 runs every suite with that node-redis major: `redis` is
 * aliased to the `redis-v4` / `redis-v5` devDependency for the tests AND the store's own
 * clients. Without it the suites use the `redis` devDependency (the current major, 6).
 */
const major = process.env.BOTWA_TEST_REDIS_CLIENT
const target = major === 'v4' ? 'redis-v4' : major === 'v5' ? 'redis-v5' : undefined
if (major && !target && major !== 'v6') throw new Error(`BOTWA_TEST_REDIS_CLIENT must be v4, v5 or v6 (got ${major})`)

export default defineConfig({
  resolve: { alias: target ? [{ find: /^redis$/, replacement: target }] : [] },
})
