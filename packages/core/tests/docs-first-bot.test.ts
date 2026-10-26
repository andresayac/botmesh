/**
 * The "Your first bot" guide (docs/guide/first-bot.md, docs/es/guide/primer-bot.md) is
 * the first complete program a new user copies. Run its code block as written, with
 * only the Baileys transport swapped for a MockProvider, and check that every
 * interaction the guide promises ("Run" section) actually happens.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Bot } from '../src/core/Bot.js'
import type { MockProvider } from '../src/testing/MockProvider.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const src = (p: string) => pathToFileURL(fileURLToPath(new URL('../src/' + p, import.meta.url))).href

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

/** The guide's first ```ts block, transport swapped for a MockProvider, `bot` exported. */
async function loadGuideBot(page: string): Promise<{ bot: Bot; provider: MockProvider }> {
  const md = await readFile(join(root, page), 'utf8')
  const code = /```ts\n([\s\S]*?)```/.exec(md)?.[1]
  expect(code, page + ' has a ts block').toBeTruthy()
  const swapped = code!
    .replace("import { BaileysProvider } from '@botmesh/baileys'\n", '')
    .replace(/from '@botmesh\/core'/, `from '${src('index.ts')}'`)
    .replace(/provider: new BaileysProvider\(\{[\s\S]*?\n {2}\}\),/, 'provider: __provider,')
  expect(swapped).not.toContain('BaileysProvider')
  const module = [
    `import { MockProvider } from '${src('testing/MockProvider.ts')}'`,
    'const __provider = new MockProvider()',
    swapped,
    'export { bot, __provider }',
  ].join('\n')
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-docs-'))
  dirs.push(dir)
  const file = join(dir, 'first-bot.ts')
  await writeFile(file, module)
  const mod = (await import(pathToFileURL(file).href)) as { bot: Bot; __provider: MockProvider }
  return { bot: mod.bot, provider: mod.__provider }
}

function chatOf(provider: MockProvider) {
  const texts = () =>
    provider.outbox.map((o) => (o.content.kind === 'text' ? o.content.text : o.content.kind === 'image' ? '[image] ' + (o.content.caption ?? '') : '[' + o.content.kind + ']'))
  return {
    async say(text: string): Promise<string> {
      const before = provider.outbox.length
      provider.incoming(text)
      for (let i = 0; i < 400 && provider.outbox.length === before; i++) await new Promise((r) => setTimeout(r, 5))
      // A flow step may send several messages: wait until the outbox is quiet.
      for (let seen = -1; seen !== provider.outbox.length; ) {
        seen = provider.outbox.length
        await new Promise((r) => setTimeout(r, 40))
      }
      return texts().slice(before).join('\n')
    },
  }
}

const PAGES = [
  {
    page: 'docs/guide/first-bot.md',
    hello: 'Hello',
    photo: 'photo',
    cancelled: 'Conversation cancelled',
    invalidEmail: 'Invalid email',
    done: 'Registration complete',
    unknown: 'did not recognize',
  },
  {
    page: 'docs/es/guide/primer-bot.md',
    hello: 'Hola',
    photo: 'foto',
    cancelled: 'Conversación cancelada',
    invalidEmail: 'Email inválido',
    done: 'Registro completo',
    unknown: 'No te entendí',
  },
]

describe.each(PAGES)('$page runs as documented', (p) => {
  it('answers hola, the slash commands, media and the registration flow', async () => {
    const { bot, provider } = await loadGuideBot(p.page)
    const chat = chatOf(provider)
    try {
      expect(await chat.say('Hóla ')).toContain(p.hello)
      expect(await chat.say('hola amigo')).toContain(p.unknown)
      // /help must list the commands, not repeat "send /help".
      const help = await chat.say('/help')
      for (const cmd of ['/reset', '/cancel', '/ping']) expect(help).toContain(cmd)
      expect(await chat.say('/ping')).toContain('pong')
      expect(await chat.say(p.photo)).toContain('[image]')
      expect(await chat.say('sticker')).toContain('[sticker]')
      await chat.say('registrar')
      await chat.say('Ana')
      expect(await chat.say('not-an-email')).toContain(p.invalidEmail)
      expect(await chat.say('/cancel')).toContain(p.cancelled)
      await chat.say('registrar')
      await chat.say('Ana 😀')
      const done = await chat.say('ana@example.com')
      expect(done).toContain(p.done)
      expect(done).toContain('Ana 😀')
    } finally {
      await bot.stop()
    }
  })
})
