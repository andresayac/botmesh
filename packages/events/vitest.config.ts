import { defineConfig } from 'vitest/config'

// The file-journal suites rewrite real files under a cross-process mutex (and fork child
// processes); on a loaded Windows machine a test can take several seconds.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 } })
