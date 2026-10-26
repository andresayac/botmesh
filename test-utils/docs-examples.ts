/**
 * Run the code blocks of a documentation example page as written.
 *
 * The example pages (docs/examples/*, docs/es/ejemplos/*) promise complete,
 * copy-pasteable files. These helpers pull a named file out of a page
 * (a fenced block whose first line is `// <file>`), write it to a temporary
 * project folder and import it, rewriting each bare `@botmesh/*` import to the
 * workspace package it names. Transports that are not under test (the real
 * WhatsApp connection) can be replaced by a stub module.
 *
 * Node-only, no network: the caller drives the imported module with
 * `MockProvider` / `createTestBot` or fakes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root (this file lives in `<root>/test-utils`). */
export const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/** Read a docs page with LF line endings (a Windows checkout may have CRLF). */
export function readPage(page: string): string {
  return readFileSync(join(repoRoot, page), 'utf8').replace(/\r\n/g, '\n')
}

/**
 * The fenced block of `md` whose first line is `// <file>` (or `# <file>` for
 * Dockerfiles and YAML). Throws when the page has no such block, or more than one.
 */
export function extractFile(md: string, file: string): string {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('```[a-z]*\\n((?://|#) ' + escaped + '\\n[\\s\\S]*?)```', 'g')
  const found = [...md.replace(/\r\n/g, '\n').matchAll(re)].map((m) => m[1]!)
  if (found.length !== 1) throw new Error(`expected exactly one block starting with "// ${file}", found ${found.length}`)
  return found[0]!
}

/** Headings that introduce the transcript block of an example page, EN and ES. */
const TRANSCRIPT_HEADINGS = ['Sample transcript', 'Transcripción de ejemplo']

/**
 * The first ```text block after the page's "Sample transcript" / "Transcripción de
 * ejemplo" heading, normalized with {@link normalizeTranscript}.
 */
export function transcriptBlock(md: string): string {
  const lf = md.replace(/\r\n/g, '\n')
  const at = TRANSCRIPT_HEADINGS.map((h) => lf.indexOf(`\n## ${h}\n`)).find((i) => i >= 0)
  if (at === undefined) throw new Error('the page has no "## Sample transcript" section')
  const block = /```text\n([\s\S]*?)```/.exec(lf.slice(at))
  if (!block) throw new Error('the transcript section has no ```text block')
  return normalizeTranscript(block[1]!)
}

/** Trailing spaces removed from every line and blank lines trimmed at both ends. */
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

/** The slice of `DevSession` (`@botmesh/core/dev`) the tests drive. */
export interface DevSessionLike {
  start(): Promise<unknown>
  handleLine(line: string): Promise<unknown>
  stop(): Promise<unknown>
}

/**
 * Run lines through the terminal simulator (`DevSession`, what `npx botmesh dev`
 * uses) with echo on, and return what it printed, normalized. `DevSession` is
 * passed in so the caller picks the copy of `@botmesh/core` the example uses. A
 * function in `lines` runs between two lines (e.g. to wait for a scheduled send)
 * and can read the output so far.
 */
export async function simulate(
  DevSession: new (opts: { load: () => Promise<unknown>; write: (t: string) => void; echo: boolean; settleMs: number }) => DevSessionLike,
  load: () => Promise<unknown>,
  lines: readonly (string | ((output: () => string) => Promise<void>))[],
): Promise<string> {
  let out = ''
  const session = new DevSession({ load, write: (t) => { out += t }, echo: true, settleMs: 60 })
  await session.start()
  try {
    for (const line of lines) {
      if (typeof line === 'string') await session.handleLine(line)
      else await line(() => out)
    }
  } finally {
    await session.stop()
  }
  return normalizeTranscript(out)
}

interface PackageInfo {
  dir: string
  exports: Record<string, unknown>
}

let packages: Map<string, PackageInfo> | undefined

function workspacePackages(): Map<string, PackageInfo> {
  if (packages) return packages
  packages = new Map()
  for (const entry of readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })) {
    const pkgFile = join(repoRoot, 'packages', entry.name, 'package.json')
    if (!entry.isDirectory() || !existsSync(pkgFile)) continue
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { name: string; exports?: Record<string, unknown> }
    packages.set(pkg.name, { dir: join(repoRoot, 'packages', entry.name), exports: pkg.exports ?? {} })
  }
  return packages
}

function exportTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>
    return exportTarget(e.import ?? e.default)
  }
  return undefined
}

export interface ResolveOptions {
  /** Workspace packages loaded from `src/*.ts` instead of the built `lib/` (e.g. `['@botmesh/core']` in core's own tests). */
  fromSource?: readonly string[]
  /** Bare specifiers replaced by a stub module with this source (a transport the test does not use). */
  stubs?: Record<string, string>
  /** Package folders whose `node_modules` resolve other bare specifiers (`pino`...), tried in order. */
  resolveFrom?: readonly string[]
}

/** Absolute file URL for a bare specifier, or `undefined` to leave it as is (`node:*`, relative). */
function resolveSpecifier(spec: string, opts: ResolveOptions, stubFiles: Map<string, string>): string | undefined {
  if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('file:')) return undefined
  const stub = stubFiles.get(spec)
  if (stub) return pathToFileURL(stub).href
  const scoped = /^(@[^/]+\/[^/]+|[^@/][^/]*)(\/.*)?$/.exec(spec)
  if (!scoped) throw new Error(`cannot parse import specifier ${spec}`)
  const [, name, sub] = scoped
  const pkg = workspacePackages().get(name!)
  if (pkg) {
    const key = sub ? '.' + sub : '.'
    const target = exportTarget(pkg.exports[key])
    if (!target) throw new Error(`${name} does not export "${key}"`)
    const file = opts.fromSource?.includes(name!) ? target.replace(/^\.\/lib\//, './src/').replace(/\.js$/, '.ts') : target
    return pathToFileURL(join(pkg.dir, file)).href
  }
  for (const from of opts.resolveFrom ?? [join(repoRoot, 'packages/core')]) {
    try {
      return pathToFileURL(createRequire(join(from, 'package.json')).resolve(spec)).href
    } catch {
      /* try the next folder */
    }
  }
  throw new Error(`cannot resolve ${spec} from the workspace`)
}

/** Rewrite every static and dynamic import of `code` to absolute file URLs. */
export function rewriteImports(code: string, opts: ResolveOptions = {}, stubFiles = new Map<string, string>()): string {
  return code.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g, (whole, lead: string, quote: string, spec: string) => {
    const url = resolveSpecifier(spec, opts, stubFiles)
    return url ? `${lead}${quote}${url}${quote}` : whole
  })
}

/** A temporary project folder holding the files of one example. */
export interface DocsProject {
  dir: string
  /** Absolute path of a project file. */
  path(file: string): string
  /** Import a project file (after its imports were rewritten). */
  import<T = Record<string, unknown>>(file: string): Promise<T>
  /** Delete the folder. */
  remove(): Promise<void>
}

/**
 * Write `files` (project-relative path → source) into a fresh temporary folder,
 * rewriting the imports of every `.js`/`.ts`/`.mjs` file, and return a handle to import them.
 */
export async function createDocsProject(files: Record<string, string>, opts: ResolveOptions = {}): Promise<DocsProject> {
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-docs-example-'))
  const stubFiles = new Map<string, string>()
  for (const [spec, source] of Object.entries(opts.stubs ?? {})) {
    const file = join(dir, '__stubs__', spec.replace(/[^a-z0-9]+/gi, '_') + '.js')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source)
    stubFiles.set(spec, file)
  }
  for (const [name, source] of Object.entries(files)) {
    const file = join(dir, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, /\.(m?js|ts)$/.test(name) ? rewriteImports(source, opts, stubFiles) : source)
  }
  return {
    dir,
    path: (file) => join(dir, file),
    import: async <T>(file: string) => (await import(pathToFileURL(join(dir, file)).href)) as T,
    remove: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  }
}
