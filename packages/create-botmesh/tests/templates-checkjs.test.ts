/**
 * The generated `src/*.js` type-check cleanly with `checkJs` against the published
 * typings (the built `lib/*.d.ts` of the workspace packages), so an editor shows no red
 * squiggles in a fresh project. Needs `pnpm build` first (CI builds before testing).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { scaffold } from '../src/scaffold.js'
import { TEMPLATE_NAMES } from '../src/templates.js'

const PACKAGES = resolve(__dirname, '../..')
const DIRS: Record<string, string> = {
  '@botmesh/core': 'core',
  '@botmesh/baileys': 'baileys-provider',
  '@botmesh/meta': 'meta-provider',
  '@botmesh/telegram': 'telegram-provider',
  '@botmesh/ai': 'ai',
  '@botmesh/sqlite-store': 'sqlite-store',
}
const built = Object.values(DIRS).every((d) => existsSync(join(PACKAGES, d, 'lib', 'index.d.ts')))

let dir = ''
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

describe.skipIf(!built)('templates type-check with checkJs', () => {
  it('reports no error in any template', async () => {
    dir = await mkdtemp(join(tmpdir(), 'create-botmesh-checkjs-'))
    for (const template of TEMPLATE_NAMES) await scaffold({ targetDir: join(dir, template), template })
    const paths = Object.fromEntries(Object.entries(DIRS).map(([name, d]) => [name, [join(PACKAGES, d, 'lib', 'index.d.ts').replace(/\\/g, '/')]]))
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext',
        allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, strict: false,
        types: ['node'], typeRoots: [join(PACKAGES, 'create-botmesh', 'node_modules', '@types').replace(/\\/g, '/')],
        paths,
      },
      include: ['*/src/**/*.js'],
    }))
    const tsc = join(PACKAGES, 'create-botmesh', 'node_modules', 'typescript', 'bin', 'tsc')
    let output = ''
    try {
      execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      output = String((err as { stdout?: string }).stdout ?? err)
    }
    expect(output).toBe('')
  }, 120_000)
})
