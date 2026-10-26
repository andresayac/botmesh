/**
 * The "Your first bot" guide (docs/guide/first-bot.md, docs/es/guide/primer-bot.md) is
 * the first complete program a new user copies. Run its bot factory as written, with a
 * MockProvider instead of the Baileys transport, and check that every interaction the
 * guide promises ("Try it" section) actually happens.
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

/**
 * The module the test runs: the guide's `bot.js` block without its real-transport start
 * block, its `defineBot` factory called with a MockProvider and the bot started. Line
 * endings are normalized first: a Windows checkout with `core.autocrlf=true` has CRLF
 * markdown, and the patterns below match LF.
 */
function guideModuleSource(md: string, page: string): string {
  const code = /```js\n(\/\/ bot\.js\n[\s\S]*?)```/.exec(md.replace(/\r\n/g, '\n'))?.[1]
  expect(code, page + ' has a bot.js block').toBeTruthy()
  const start = code!.indexOf('\nif (isMainModule(import.meta))')
  expect(start, page + ' starts the real provider only under isMainModule').toBeGreaterThan(0)
  const swapped = code!
    .slice(0, start)
    .replace("import { BaileysProvider } from '@botmesh/baileys'\n", '')
    .replace(/from '@botmesh\/core'/, `from '${src('index.ts')}'`)
  expect(swapped).not.toContain('BaileysProvider')
  expect(swapped).toContain('export default createBot')
  return [
    `import { MockProvider } from '${src('testing/MockProvider.ts')}'`,
    swapped,
    'const __provider = new MockProvider()',
    'const bot = await createBot(__provider)',
    'await bot.start()',
    'export { bot, __provider }',
  ].join('\n')
}

async function loadGuideBot(page: string): Promise<{ bot: Bot; provider: MockProvider }> {
  const md = await readFile(join(root, page), 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-docs-'))
  dirs.push(dir)
  const file = join(dir, 'first-bot.ts')
  await writeFile(file, guideModuleSource(md, page))
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
    greet: 'Hí ',
    hello: 'Hello',
    unknownText: 'hi there',
    unknown: 'did not get that',
    photo: 'photo',
    poll: 'poll',
    flow: 'register',
    cancelled: 'Conversation cancelled',
    invalidEmail: 'not an email',
    done: 'Done!',
  },
  {
    page: 'docs/es/guide/primer-bot.md',
    greet: 'Hóla ',
    hello: 'Hola',
    unknownText: 'hola amigo',
    unknown: 'No te entendí',
    photo: 'foto',
    poll: 'encuesta',
    flow: 'registro',
    cancelled: 'Conversación cancelada',
    invalidEmail: 'no es un email',
    done: '¡Listo!',
  },
]

describe.each(PAGES)('$page runs as documented', (p) => {
  it('extracts the same program from a CRLF checkout (Windows, core.autocrlf=true)', async () => {
    const md = (await readFile(join(root, p.page), 'utf8')).replace(/\r\n/g, '\n')
    expect(guideModuleSource(md.replace(/\n/g, '\r\n'), p.page).replace(/\r\n/g, '\n')).toBe(guideModuleSource(md, p.page))
  })

  it('answers the greeting, the slash commands, media, a poll and the registration flow', async () => {
    const { bot, provider } = await loadGuideBot(p.page)
    const chat = chatOf(provider)
    try {
      expect(await chat.say(p.greet)).toContain(p.hello)
      expect(await chat.say(p.unknownText)).toContain(p.unknown)
      // /help must list the commands, not repeat "send /help".
      const help = await chat.say('/help')
      for (const cmd of ['/reset', '/cancel', '/ping']) expect(help).toContain(cmd)
      expect(await chat.say('/ping')).toContain('pong')
      expect(await chat.say(p.photo)).toContain('[image]')
      expect(await chat.say(p.poll)).toContain('[poll]')
      await chat.say(p.flow)
      await chat.say('Ana')
      expect(await chat.say('not-an-email')).toContain(p.invalidEmail)
      expect(await chat.say('/cancel')).toContain(p.cancelled)
      await chat.say(p.flow)
      await chat.say('Ana 😀')
      await chat.say('ana@example.com')
      const done = await chat.say('1')
      expect(done).toContain(p.done)
      expect(done).toContain('Ana 😀')
    } finally {
      await bot.stop()
    }
    // A dozen sequential turns, each waiting for a quiet outbox: slow on a loaded machine.
  }, 30_000)
})
