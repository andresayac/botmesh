/**
 * "Next steps" must work in the user's shell, and an old Node is reported up front
 * instead of surfacing later as Node's own `bad option: --env-file-if-exists`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scaffold } from '../src/scaffold.js'
// Plain-JS bin; typed through its JSDoc because tsconfig sets `allowJs`.
import { copyEnvCommand, createCommand, main, nodeVersionWarning } from '../src/cli.js'
import { BOTMESH_VERSIONS } from '../src/versions.js'

const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })

describe('copying .env.example', () => {
  it('uses copy on Windows (cmd.exe has no cp) and cp elsewhere', () => {
    expect(copyEnvCommand('win32')).toBe('copy .env.example .env')
    expect(copyEnvCommand('linux')).toBe('cp .env.example .env')
    expect(copyEnvCommand('darwin')).toBe('cp .env.example .env')
  })

  it('the CLI prints the command for this platform', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-botmesh-cli-'))
    dirs.push(root)
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')) })
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      await main([join(root, 'bot'), '--yes'])
    } finally {
      Object.defineProperty(process, 'platform', platform)
      spy.mockRestore()
    }
    expect(lines.join('\n')).toMatch(/copy \.env\.example \.env/)
    expect(lines.join('\n')).not.toMatch(/\bcp \.env\.example/)
  })

  it('the generated README shows both forms', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-botmesh-cli-'))
    dirs.push(root)
    await scaffold({ targetDir: join(root, 'bot'), template: 'baileys' })
    const readme = await readFile(join(root, 'bot', 'README.md'), 'utf8')
    expect(readme).toMatch(/cp \.env\.example \.env/)
    expect(readme).toMatch(/copy \.env\.example \.env/)
  })
})

describe('Node version check', () => {
  it('warns below 22.12 (the generated scripts need --env-file-if-exists)', () => {
    expect(nodeVersionWarning('22.8.0')).toMatch(/22\.12/)
    expect(nodeVersionWarning('20.11.1')).toMatch(/22\.12/)
    expect(nodeVersionWarning('22.12.0')).toBeUndefined()
    expect(nodeVersionWarning('24.1.0')).toBeUndefined()
  })
})

describe('--help', () => {
  it('names the dist-tag of the current prerelease, not a stale one', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')) })
    try {
      await main(['--help'])
    } finally {
      spy.mockRestore()
    }
    const help = lines.join('\n')
    const core = BOTMESH_VERSIONS['@botmesh/core'].replace(/^\^/, '')
    const tag = core.includes('-') ? '@' + core.split('-')[1]!.split('.')[0] : ''
    expect(help).toContain('npm create botmesh' + tag + ' my-bot')
    for (const m of help.matchAll(/npm create botmesh(@[a-z]+)?/g)) expect(m[1] ?? '').toBe(tag)
  })

  it('createCommand() drops the tag for a stable core and keeps the prerelease id otherwise', () => {
    expect(createCommand('2.0.0-beta.3')).toBe('npm create botmesh@beta')
    expect(createCommand('^2.0.0-rc.1')).toBe('npm create botmesh@rc')
    expect(createCommand('^2.0.0')).toBe('npm create botmesh')
  })
})
