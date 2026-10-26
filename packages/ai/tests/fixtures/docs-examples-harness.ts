/**
 * Runs an AI example page of the docs (docs/examples/ai-*.md and its Spanish mirror) the
 * way a reader would: the page's `bot.js` block is loaded into the terminal simulator
 * (`DevSession` from `@botmesh/core/dev`, the engine behind `npx botmesh dev`), the user
 * lines of the page's transcript are typed in, and the simulator's output is returned so
 * the test can compare it with the transcript printed on the page. The model is a scripted
 * `MockAIProvider` (see docs-ai-shim.ts); the real-transport start block is dropped.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DevSession, type DevProvider } from '@botmesh/core/dev'
import { defineBot, type Bot } from '@botmesh/core'
import { MockAIProvider, type MockOptions } from '../../src/testing.js'
import { docsAIHarness } from './docs-ai-shim.js'
import type { AIPluginConfig, GenerateInput } from '../../src/index.js'

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const pkgDir = fileURLToPath(new URL('../../', import.meta.url))
const shim = pathToFileURL(fileURLToPath(new URL('./docs-ai-shim.ts', import.meta.url))).href

export async function readPage(page: string): Promise<string> {
  // A Windows checkout with core.autocrlf=true has CRLF markdown; the patterns use LF.
  return (await readFile(join(repoRoot, page), 'utf8')).replace(/\r\n/g, '\n')
}

/** The page's complete program: the fenced block that starts with `// bot.js`. */
export function botBlock(md: string): string {
  const code = /```js\n(\/\/ bot\.js\n[\s\S]*?)```/.exec(md)?.[1]
  if (!code) throw new Error('the page has no ```js block starting with // bot.js')
  return code
}

/** The fenced block of the given language whose first line is `// <name>` or `<!-- <name> -->`. */
export function namedBlock(md: string, lang: string, name: string): string {
  const re = new RegExp('```' + lang + '\\n((?://|<!--) ' + name.replace(/\./g, '\\.') + '[^\\n]*\\n[\\s\\S]*?)```')
  const code = re.exec(md)?.[1]
  if (!code) throw new Error(`the page has no \`\`\`${lang} block named ${name}`)
  return code
}

/** The transcript printed on the page: the first ```text block that starts with `user › `. */
export function pageTranscript(md: string): string {
  const block = /```text\n(user › [\s\S]*?)```/.exec(md)?.[1]
  if (!block) throw new Error('the page has no ```text transcript block')
  return block
}

/** What the reader types: every `user › ` line of the transcript. */
export function userLines(transcript: string): string[] {
  return transcript.split('\n').filter((l) => l.startsWith('user › ')).map((l) => l.slice('user › '.length))
}

/**
 * The module the simulator loads: the page's program with the real transport's import
 * and its `isMainModule` start block removed, and `@botmesh/ai` pointed at the shim.
 */
export function moduleSource(code: string): string {
  const start = code.indexOf('\nif (isMainModule(import.meta))')
  if (start < 0) throw new Error('the program must start the real provider only under isMainModule')
  const body = code
    .slice(0, start)
    .replace(/^import \{ (?:BaileysProvider|TelegramProvider) \} from '@botmesh\/(?:baileys|telegram)'\n/gm, '')
    .replace("from '@botmesh/ai'", `from '${shim}'`)
  if (/BaileysProvider|TelegramProvider/.test(body)) throw new Error('the factory must use the provider it receives')
  if (!body.includes('export default createBot')) throw new Error('the page must export its defineBot factory')
  return body + '\n'
}

/** The text of the last user turn the model received. */
export function lastUserText(input: GenerateInput): string {
  const last = [...input.messages].reverse().find((m) => m.role === 'user')
  const content = last?.content as unknown
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p: { text?: string }) => p.text ?? '').join('')
  return ''
}

export interface SimRun {
  output: string
  mock: MockAIProvider
  configs: AIPluginConfig[]
  bot: Bot
  provider: DevProvider
  /** Stop the simulated bot and delete the temporary files. */
  close(): Promise<void>
}

export interface SimOptions {
  /** Scripted model. */
  reply: MockOptions['reply']
  /** Lines to type (default: the `user › ` lines of the page transcript). */
  lines: string[]
  /** Extra files written next to bot.js (e.g. `faq.md`). */
  files?: Record<string, string>
  /** Called after the bot is built, before any line is typed. */
  setup?: (bot: Bot, provider: DevProvider) => void
}

type Factory = (provider: unknown) => Promise<Bot> | Bot

/**
 * Write the page's program (see {@link moduleSource}) and its extra files to a temporary
 * folder inside the package, so bare imports (@botmesh/core) resolve like in a real
 * project, and import its factory with a scripted model installed.
 */
export async function importProgram(
  code: string,
  reply: MockOptions['reply'],
  files: Record<string, string> = {},
): Promise<{ factory: Factory; mock: MockAIProvider; configs: AIPluginConfig[]; file: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(pkgDir, '.docs-example-'))
  const file = join(dir, 'bot.js')
  await writeFile(file, moduleSource(code))
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
  const mock = new MockAIProvider({ reply })
  const harness = docsAIHarness()
  harness.provider = mock
  harness.configs.length = 0
  const mod = (await import(pathToFileURL(file).href)) as { default: Factory }
  return {
    factory: mod.default,
    mock,
    configs: harness.configs,
    file,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

/** Run the page's program in the simulator and capture what a reader would see. */
export async function runInSimulator(code: string, opts: SimOptions): Promise<SimRun> {
  const program = await importProgram(code, opts.reply, opts.files)

  const out: string[] = []
  let live: { bot: Bot; provider: DevProvider } | undefined
  const session = new DevSession({
    load: async () => {
      return {
        default: defineBot(async (provider) => {
          const bot = await program.factory(provider)
          live = { bot, provider: provider as DevProvider }
          opts.setup?.(bot, provider as DevProvider)
          return bot
        }),
      }
    },
    write: (t) => { out.push(t) },
    echo: true,
    settleMs: 60,
  })
  await session.start()
  for (const line of opts.lines) await session.handleLine(line)
  await session.drain()
  if (!live) throw new Error('the simulator did not build the bot:\n' + out.join(''))
  return {
    output: out.join(''),
    mock: program.mock,
    configs: [...program.configs],
    bot: live.bot,
    provider: live.provider,
    async close() {
      await session.stop()
      await program.cleanup()
    },
  }
}
