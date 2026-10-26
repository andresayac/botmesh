import { defineConfig } from 'vitest/config'

/**
 * BOTWA_TEST_MONGO_DRIVER=v6 runs every suite with the mongodb 6.x driver: `mongodb` is
 * aliased to the `mongodb-v6` devDependency for the tests AND the store's own client.
 * Without it the suites use the `mongodb` devDependency (the current major, 7). The package
 * accepts both majors as a peer.
 */
const major = process.env.BOTWA_TEST_MONGO_DRIVER
if (major && major !== 'v6' && major !== 'v7') throw new Error(`BOTWA_TEST_MONGO_DRIVER must be v6 or v7 (got ${major})`)

export default defineConfig({
  resolve: { alias: major === 'v6' ? [{ find: /^mongodb$/, replacement: 'mongodb-v6' }] : [] },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
})
