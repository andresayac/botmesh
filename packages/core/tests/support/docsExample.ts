/**
 * Runs an example page of the docs (docs/examples/*.md, docs/es/ejemplos/*.md) the way a
 * reader would: its complete `bot.js` block is loaded in the terminal simulator
 * (`DevSession`, the engine behind `npx botmesh dev`) and fed the `user › ...` lines of the
 * page's "Sample transcript" block. The captured simulator output must be exactly that block,
 * so the transcript on the page is a real run, not an invented one.
 *
 * Page contract:
 *  - one ```js block whose first line is `// bot.js` (or ```ts with `// bot.ts`): a
 *    `defineBot` factory exported as default, real transports started only under
 *    `if (isMainModule(import.meta))` (that block and the transport imports are dropped);
 *  - the first ```text block after the "Sample transcript" / "Transcripción de ejemplo"
 *    heading. Lines starting with `user › ` are what the user types (simulator commands
 *    such as `:click 2` included); every other line is simulator output.
 *
 * To (re)capture a transcript after changing an example, leave only its `user › ` lines and
 * run the test with `BOTMESH_UPDATE_DOCS=1`: the block is replaced with the real output.
 */
import { expect } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { Bot } from '../../src/core/Bot.js'
import { DevSession } from '../../src/dev/session.js'
import { formatMessage } from '../../src/dev/render.js'

/** Repository root (`docs/` lives there). */
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

const srcUrl = (p: string) => pathToFileURL(fileURLToPath(new URL('../../src/' + p, import.meta.url))).href

const PROMPT = 'user › '
const TRANSCRIPT_HEADING = /^##+ (?:Sample transcript|Transcripción de ejemplo)\s*$/m

/** Reads a docs page with LF line endings (a Windows checkout may have CRLF). */
export async function readPage(page: string): Promise<string> {
  return (await readFile(join(repoRoot, page), 'utf8')).replace(/\r\n/g, '\n')
}

/** The page's complete `bot.js` / `bot.ts` block, verbatim. */
export function botFile(md: string, page: string): string {
  const code = /```(?:js|ts)\n(\/\/ bot\.[jt]s\n[\s\S]*?)```/.exec(md)?.[1]
  expect(code, page + ' has a complete // bot.js block').toBeTruthy()
  return code!
}

/**
 * The module the simulator loads: the page's file without its real-transport start block
 * and transport imports, with `@botmesh/core` pointing at the sources under test.
 */
export function simulatorModule(md: string, page: string): string {
  const code = botFile(md, page)
  const start = code.indexOf('\nif (isMainModule(import.meta))')
  expect(start, page + ' starts the real provider only under isMainModule').toBeGreaterThan(0)
  expect(code, page + ' exports the factory').toContain('export default createBot')
  const swapped = code
    .slice(0, start)
    .replace(/^import \{[^}]*\} from '@botmesh\/(?:baileys|telegram|meta)'\n/gm, '')
    .replace(/from '@botmesh\/core'/g, `from '${srcUrl('index.ts')}'`)
  expect(swapped, page + ' only uses @botmesh/core in the factory').not.toMatch(/@botmesh\/(?!core)/)
  return swapped
}

/** The "Sample transcript" block of the page, verbatim. */
export function transcript(md: string, page: string): string {
  const heading = TRANSCRIPT_HEADING.exec(md)
  expect(heading, page + ' has a "Sample transcript" heading').toBeTruthy()
  const block = /```text\n([\s\S]*?)```/.exec(md.slice(heading!.index))?.[1]
  expect(block, page + ' has a ```text block after the transcript heading').toBeTruthy()
  return block!
}

/** What the user types in a transcript, in order. */
export function transcriptInputs(text: string): string[] {
  return text.split('\n').filter((l) => l.startsWith(PROMPT)).map((l) => l.slice(PROMPT.length))
}

/**
 * Imports the page's bot factory (as the simulator would) so a test can build the bot on
 * its own provider, e.g. a `MockProvider` under fake timers.
 */
export async function loadPageFactory(page: string): Promise<(provider: unknown) => Promise<Bot> | Bot> {
  const md = await readPage(page)
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-example-'))
  dirs.push(dir)
  const file = join(dir, 'bot.ts')
  await writeFile(file, simulatorModule(md, page))
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default: (provider: unknown) => Promise<Bot> | Bot }
  return mod.default
}

export interface RunOptions {
  /** Display name of the simulated user (`npx botmesh dev bot.js --name <name>`). */
  name?: string
  /** Runs after each input settled; e.g. wait for a delayed reminder. */
  afterInput?: (input: string, index: number) => Promise<void>
  /** Bytes returned for `:media` paths. */
  readFile?: (path: string) => Promise<Uint8Array>
}

const dirs: string[] = []

/** Removes the temporary modules written by {@link runPageTranscript}. Call in `afterEach`. */
export async function cleanupDocsExamples(): Promise<void> {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
}

/**
 * Runs the page's bot in the simulator with the inputs of its transcript and returns the
 * captured output next to the transcript printed on the page.
 */
export async function runPageTranscript(page: string, opts: RunOptions = {}): Promise<{ actual: string; expected: string }> {
  const md = await readPage(page)
  const expected = transcript(md, page)
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-example-'))
  dirs.push(dir)
  const file = join(dir, 'bot.ts')
  await writeFile(file, simulatorModule(md, page))

  const out: string[] = []
  const session = new DevSession({
    load: () => import(/* @vite-ignore */ pathToFileURL(file).href),
    write: (text) => { out.push(text) },
    name: opts.name ?? 'Dev User',
    settleMs: 60,
    maxSettleMs: 5000,
    readFile: opts.readFile ?? (async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
  })
  expect(await session.start(), page + ' bot starts in the simulator').toBe(true)
  try {
    const inputs = transcriptInputs(expected)
    expect(inputs.length, page + ' transcript has user lines').toBeGreaterThan(0)
    for (const [i, input] of inputs.entries()) {
      // A terminal shows what the user typed after the prompt.
      out.push(formatMessage(PROMPT, input))
      await session.handleLine(input)
      if (opts.afterInput) await opts.afterInput(input, i)
    }
    await session.drain()
  } finally {
    await session.stop()
  }
  const trimEnds = (s: string) => s.split('\n').map((l) => l.trimEnd()).join('\n').trimEnd()
  const actual = trimEnds(out.join(''))
  if (process.env.BOTMESH_UPDATE_DOCS === '1' && actual !== trimEnds(expected)) {
    const at = TRANSCRIPT_HEADING.exec(md)!.index
    const rest = md.slice(at).replace(/```text\n[\s\S]*?```/, () => '```text\n' + actual + '\n```')
    await writeFile(join(repoRoot, page), md.slice(0, at) + rest)
    return { actual, expected: actual }
  }
  return { actual, expected: trimEnds(expected) }
}
