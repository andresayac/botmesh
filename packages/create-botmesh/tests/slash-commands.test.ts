import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { scaffold } from '../src/scaffold.js'
import type { TemplateName } from '../src/templates.js'

/**
 * The transport templates ship a `menu` flow whose `ask` takes any text. Without the
 * built-in slash commands, `/reset` or `/cancel` typed there was taken as the answer
 * (the bot replied "🏓 ¡pong!"), `/help` got no reply, and in the `ai` template every
 * command went to the LLM. The generated factory must install `slashCommandsPlugin`
 * (before `aiPlugin`, the catch-all), so commands always escape a flow.
 */

const tempDirs: string[] = []
afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

const coreLib = fileURLToPath(new URL('../../core/lib/', import.meta.url))
const coreUrl = (p: string) => pathToFileURL(join(coreLib, p)).href

/** Transport/plugin stubs; the AI stub is a catch-all that answers every leftover text. */
const STUBS = [
  'export class BaileysProvider {}',
  'export class CloudAPIProvider {}',
  'export class TelegramProvider {}',
  'export const aiPlugin = () => ({',
  "  name: 'ai',",
  '  install(ctx) {',
  "    ctx.bot.onType('text', async (c) => { await c.reply('AI-STUB: ' + c.body) })",
  '  },',
  '})',
  '',
].join('\n')

interface Mock {
  incoming(text: string): void
  outbox: Array<{ content: { kind: string; text?: string } }>
}
interface BotLike {
  start(): Promise<void>
  stop(): Promise<void>
}

async function load(template: TemplateName): Promise<{ bot: BotLike; provider: Mock }> {
  const base = await mkdtemp(join(tmpdir(), 'create-botmesh-slash-'))
  tempDirs.push(base)
  const target = join(base, 'slash-' + template)
  await scaffold({ targetDir: target, template })
  const source = await readFile(join(target, 'src/bot.js'), 'utf8')
  const runnable = source
    .replace(/from '@botmesh\/core'/g, `from '${coreUrl('index.js')}'`)
    .replace(/from '@botmesh\/(?:baileys|meta|telegram|ai)'/g, "from './stubs.mjs'")
  await writeFile(join(target, 'src/stubs.mjs'), STUBS)
  const entry = join(target, 'src/bot.sim.mjs')
  await writeFile(entry, runnable)
  const { MockProvider } = (await import(coreUrl('testing/index.js'))) as { MockProvider: new () => Mock }
  const createBot = ((await import(pathToFileURL(entry).href)) as { default: (p: Mock) => BotLike | Promise<BotLike> }).default
  const provider = new MockProvider()
  const bot = await createBot(provider)
  await bot.start()
  return { bot, provider }
}

async function say(provider: Mock, text: string): Promise<string> {
  const before = provider.outbox.length
  provider.incoming(text)
  for (let i = 0; i < 200 && provider.outbox.length === before; i++) await new Promise((r) => setTimeout(r, 5))
  for (let seen = -1; seen !== provider.outbox.length; ) {
    seen = provider.outbox.length
    await new Promise((r) => setTimeout(r, 30))
  }
  return provider.outbox
    .slice(before)
    .map((o) => o.content.text ?? '[' + o.content.kind + ']')
    .join('\n')
}

describe.skipIf(!existsSync(join(coreLib, 'index.js')))('slash commands in the transport templates', () => {
  it.each(['baileys', 'meta', 'telegram', 'ai'] as TemplateName[])('template "%s": /reset and /cancel escape the menu flow, /help answers', async (template) => {
    const { bot, provider } = await load(template)
    try {
      expect(await say(provider, 'menu')).toContain('Responde 1 o 2')
      const reset = await say(provider, '/reset')
      expect(reset).not.toContain('pong')
      expect(reset).not.toContain('AI-STUB')
      expect(reset).toMatch(/reiniciad/i)

      expect(await say(provider, 'menu')).toContain('Responde 1 o 2')
      const cancel = await say(provider, '/cancel')
      expect(cancel).not.toContain('pong')
      expect(cancel).toMatch(/cancelad/i)

      const help = await say(provider, '/help')
      expect(help).not.toContain('AI-STUB')
      for (const cmd of ['/reset', '/cancel']) expect(help).toContain(cmd)
    } finally {
      await bot.stop()
    }
  })

  it('template "ai" installs slashCommandsPlugin before aiPlugin (the catch-all)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'create-botmesh-slash-'))
    tempDirs.push(base)
    await scaffold({ targetDir: join(base, 'ai'), template: 'ai' })
    const bot = await readFile(join(base, 'ai', 'src/bot.js'), 'utf8')
    const slash = bot.indexOf('bot.plug(slashCommandsPlugin)')
    expect(slash).toBeGreaterThan(-1)
    expect(slash).toBeLessThan(bot.indexOf('aiPlugin({'))
  })
})
