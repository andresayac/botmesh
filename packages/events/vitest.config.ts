import { defineConfig } from 'vitest/config'

// The repo convention (AGENTS.md): a 10 s default per test. The shared-file journal tests
// rewrite one file under a cross-process mutex; on a loaded machine the vitest 5 s default
// was too tight for them.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 10_000 } })
