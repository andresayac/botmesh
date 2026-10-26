/**
 * Runs the example pages of the docs (docs/examples/*.md, docs/es/ejemplos/*.md) as
 * written: the page's `// bot.js` block becomes a module whose real transport is left
 * out, and every terminal transcript on the page is replayed in the `botmesh dev`
 * simulator (`DevSession`, whose `DevProvider` is a `MockProvider`). The test then
 * compares what the simulator printed with what the page shows, line by line.
 *
 * A transcript is a ```text block whose first line is a simulator prompt
 * (`user › `, `ana › `, `ana @ team › `). Lines that start with the current prompt
 * are typed: a message is sent, a `:command` (`:as`, `:group`, `:dm`, `:reset`) is
 * run. Every other line is output the simulator must print.
 *
 * The module is runtime-dependency-free: the caller passes the `DevSession` class of
 * the `@botmesh/core` copy it tests (src in core, lib elsewhere).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The subset of `DevSession` the replay uses. */
export interface DevSessionLike {
  start(): Promise<boolean>
  handleLine(line: string): Promise<unknown>
  drain(): Promise<void>
  stop(): Promise<void>
  prompt(): string
}

export type DevSessionCtor = new (options: {
  load: () => Promise<unknown>
  write: (text: string) => void
  user?: string
  name?: string
  group?: string
  echo?: boolean
  color?: boolean
  cwd?: string
  settleMs?: number
}) => DevSessionLike

export interface ExampleModuleOptions {
  /**
   * Module specifier → what to import instead (an absolute file URL), or `null` to drop
   * the import (the real transports, which only the `isMainModule` block uses). Every
   * import of the block must be listed.
   */
  imports: Record<string, string | null>
  /** Exact text replacements applied afterwards; each `from` must occur in the block. */
  replace?: Array<[from: string, to: string]>
}

const normalize = (md: string) => md.replace(/\r\n/g, '\n')

/** The `// bot.js` (or `// bot.ts`) block of a page, as written. */
export function exampleBlock(md: string, page: string): string {
  const code = /```(?:js|ts)\n(\/\/ bot\.[jt]s\n[\s\S]*?)```/.exec(normalize(md))?.[1]
  if (!code) throw new Error(`${page}: no \`// bot.js\` code block`)
  return code
}

/**
 * The page's bot module, ready to import: the real-transport start block cut off,
 * imports rewritten, `export default createBot` kept.
 */
export function exampleModuleSource(md: string, page: string, opts: ExampleModuleOptions): string {
  const code = exampleBlock(md, page)
  const start = code.indexOf('\nif (isMainModule(import.meta))')
  if (start < 0) throw new Error(`${page}: the real transport must start only under isMainModule(import.meta)`)
  let out = code.slice(0, start)
  out = out.replace(/^import (.+) from '([^']+)'\n/gm, (line, what: string, spec: string) => {
    if (!(spec in opts.imports)) throw new Error(`${page}: unexpected import of '${spec}'`)
    const to = opts.imports[spec]
    return to === null ? '' : `import ${what} from '${to}'\n`
  })
  for (const [from, to] of opts.replace ?? []) {
    if (!out.includes(from)) throw new Error(`${page}: expected ${JSON.stringify(from)} in the bot.js block`)
    out = out.split(from).join(to)
  }
  if (!/^export default createBot$/m.test(out)) throw new Error(`${page}: the block must \`export default createBot\``)
  return out
}

const PROMPT = /^(\S+?)(?: @ (\S+))? › /

/** Every simulator transcript of the page, as lines. */
export function exampleTranscripts(md: string): string[][] {
  const blocks = [...normalize(md).matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1]!.replace(/\n$/, '').split('\n'))
  return blocks.filter((lines) => PROMPT.test(lines[0] ?? '') && !lines[0]!.startsWith('bot › '))
}

/** A temporary folder for the module (and any file the bot writes); removed by `dispose()`. */
export async function exampleWorkspace(): Promise<{ dir: string; write(name: string, source: string): Promise<string>; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-example-'))
  return {
    dir,
    async write(name, source) {
      const file = join(dir, name)
      await writeFile(file, source)
      return pathToFileURL(file).href
    },
    dispose: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  }
}

const tidy = (lines: string[]) => {
  const out = lines.map((l) => l.replace(/\s+$/, ''))
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/**
 * Replay one transcript in a fresh simulator session and return what it printed next
 * to what the page shows (both trimmed of trailing spaces), from the first typed line.
 */
export async function replayTranscript(
  DevSession: DevSessionCtor,
  moduleUrl: string,
  lines: string[],
  opts: { cwd?: string; name?: string } = {},
): Promise<{ expected: string; actual: string }> {
  const first = PROMPT.exec(lines[0]!)!
  let printed = ''
  const session = new DevSession({
    load: () => import(moduleUrl),
    write: (t) => { printed += t },
    user: first[1],
    ...(opts.name ? { name: opts.name } : {}),
    group: first[2],
    echo: true,
    color: false,
    // What `botmesh dev` uses when input is piped: each line waits for the bot to go quiet.
    settleMs: 200,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  })
  if (!(await session.start())) throw new Error('the example bot did not start:\n' + printed)
  const from = printed.length
  try {
    for (const line of lines) {
      const prompt = session.prompt()
      if (!line.startsWith(prompt)) continue
      const typed = line.slice(prompt.length)
      // The simulator echoes messages itself; a :command shows as typed in a terminal.
      if (typed.startsWith(':') && !typed.startsWith('::')) printed += prompt + typed + '\n'
      await session.handleLine(typed)
    }
    await session.drain()
  } finally {
    await session.stop()
  }
  return { expected: tidy(lines), actual: tidy(printed.slice(from).split('\n')) }
}
