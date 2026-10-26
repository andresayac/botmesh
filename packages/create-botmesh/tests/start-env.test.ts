import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { scaffold } from '../src/scaffold.js'
import { TEMPLATE_NAMES, type TemplateName } from '../src/templates.js'

/**
 * `npm start` before filling in `.env` (the most common first-run mistake) must stop
 * with one clear line naming the missing variables, BEFORE any provider is built:
 * otherwise Telegram polls `/botundefined/getMe` ("Not Found"), the Cloud API suggests
 * disabling webhook signatures and the AI fails on every message.
 */

const tempDirs: string[] = []
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'create-botmesh-env-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

const coreLib = fileURLToPath(new URL('../../core/lib/', import.meta.url))

/** Provider/plugin stubs: building one prints a marker and exits, so no network is touched. */
const STUBS = [
  "const built = (name) => class { constructor() { process.stdout.write('BUILT ' + name + '\\n'); process.exit(42) } }",
  "export const BaileysProvider = built('BaileysProvider')",
  "export const CloudAPIProvider = built('CloudAPIProvider')",
  "export const TelegramProvider = built('TelegramProvider')",
  "export const SQLiteStore = built('SQLiteStore')",
  "export const aiPlugin = () => ({ name: 'ai-stub', install() {} })",
  '',
].join('\n')

/** Env vars `npm start` cannot run without, per template (none for the QR-only Baileys ones). */
const REQUIRED: Partial<Record<TemplateName, string[]>> = {
  meta: ['META_TOKEN', 'META_PHONE_ID', 'META_VERIFY_TOKEN', 'META_APP_SECRET'],
  telegram: ['TELEGRAM_TOKEN'],
  ai: ['ANTHROPIC_API_KEY'],
  'ai-full': ['ANTHROPIC_API_KEY'],
}
const ALL_VARS = [...new Set(Object.values(REQUIRED).flat())]

async function prepare(template: TemplateName): Promise<string> {
  const target = join(await makeTempDir(), 'start-' + template)
  await scaffold({ targetDir: target, template })
  const source = await readFile(join(target, 'src/bot.js'), 'utf8')
  const runnable = source
    .replace(/from '@botmesh\/core'/g, `from '${pathToFileURL(join(coreLib, 'index.js')).href}'`)
    .replace(/from '@botmesh\/(?:baileys|meta|telegram|ai|sqlite-store)'/g, "from './stubs.mjs'")
  await writeFile(join(target, 'src/stubs.mjs'), STUBS)
  await writeFile(join(target, 'src/bot.sim.mjs'), runnable)
  return join(target, 'src/bot.sim.mjs')
}

function start(entry: string, env: Record<string, string>) {
  const base = { ...process.env }
  for (const name of ALL_VARS) delete base[name]
  return spawnSync(process.execPath, [entry], { encoding: 'utf8', env: { ...base, ...env }, timeout: 30_000 })
}

describe.skipIf(!existsSync(join(coreLib, 'index.js')))('npm start checks the required env vars', () => {
  it.each(Object.keys(REQUIRED) as TemplateName[])('template "%s" names every missing variable and builds nothing', async (template) => {
    const run = start(await prepare(template), {})
    expect(run.stdout).not.toContain('BUILT')
    expect(run.status).toBe(1)
    for (const name of REQUIRED[template]!) expect(run.stderr).toContain(name)
    expect(run.stderr).toContain('.env.example')
    // One readable line, not a stack trace.
    expect(run.stderr).not.toMatch(/\n\s+at /)
  })

  it.each(Object.keys(REQUIRED) as TemplateName[])('template "%s" builds its provider once every variable is set', async (template) => {
    const env = Object.fromEntries(REQUIRED[template]!.map((name) => [name, 'x']))
    const run = start(await prepare(template), env)
    expect(run.stdout).toContain('BUILT')
    expect(run.status).toBe(42)
  })

  it('the QR-only templates need no env var to start', async () => {
    const qrOnly = TEMPLATE_NAMES.filter((t) => !REQUIRED[t])
    expect(qrOnly).toEqual(['baileys', 'games', 'support', 'store', 'restaurant', 'clinic'])
    const run = start(await prepare('baileys'), {})
    expect(run.stdout).toContain('BUILT BaileysProvider')
  })

  it.each(['ai', 'ai-full'] as TemplateName[])('template "%s" warns in the factory when the API key is missing (npm run dev)', async (template) => {
    const target = join(await makeTempDir(), 'warn-' + template)
    await scaffold({ targetDir: target, template })
    const bot = await readFile(join(target, 'src/bot.js'), 'utf8')
    const factory = bot.slice(bot.indexOf('const createBot = defineBot('), bot.indexOf('export default createBot'))
    expect(factory).toMatch(/if \(!process\.env\.ANTHROPIC_API_KEY\) bot\.logger\.warn\(/)
  })
})
