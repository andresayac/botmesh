/**
 * Every class that `implements` a public interface (MockProvider, ChaosProvider,
 * RecordingProvider…) must still satisfy it when a consumer compiles with
 * `exactOptionalPropertyTypes` and `skipLibCheck: false`: TS2420 there breaks
 * their build inside our `.d.ts`. The rest of the source is not held to that flag.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('classes implementing public interfaces under exactOptionalPropertyTypes', () => {
  it('report no TS2420', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botmesh-exact-'))
    try {
      const config = join(dir, 'tsconfig.json')
      writeFileSync(config, JSON.stringify({
        extends: join(pkg, 'tsconfig.json').replaceAll('\\', '/'),
        compilerOptions: { noEmit: true, exactOptionalPropertyTypes: true, rootDir: pkg.replaceAll('\\', '/') },
        include: [join(pkg, 'src/**/*').replaceAll('\\', '/')],
      }))
      let output = ''
      try {
        execFileSync(process.execPath, [join(pkg, 'node_modules/typescript/bin/tsc'), '-p', config], { encoding: 'utf8' })
      } catch (err) {
        output = String((err as { stdout?: unknown }).stdout ?? '')
      }
      const implementsErrors = output.split(/\r?\n/).filter((line) => line.includes('error TS2420'))
      expect(implementsErrors).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
