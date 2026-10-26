/**
 * The stdio transport: newline-delimited JSON-RPC over a pair of streams.
 *
 * {@link serveStream} is the testable half (any async iterable in, a `write` callback out);
 * {@link runStdio} wires `process.stdin`/`process.stdout`, keeps stdout reserved for protocol
 * messages and sends every diagnostic to stderr. `--docs <dir>` (or `BOTMESH_DOCS_DIR`; the deprecated `BOTWA_DOCS_DIR` is still read)
 * enables the documentation tools.
 */
import { statSync } from 'node:fs'

import {
  LineDecoder,
  RPC_ERROR,
  encodeMessage,
  errorResponse,
  idOf,
  type JsonRpcFailure,
  type JsonRpcResult,
  type OversizedLine,
} from './protocol.js'
import { createMcpServer, type McpServer, type McpToolInfo } from './server.js'
import { MCP_SERVER_VERSION } from './version.js'

/** Everything a single protocol session needs. */
export interface ServeOptions {
  server: McpServer
  /** Write one protocol message; a returned promise is awaited (backpressure). */
  write(line: string): void | Promise<void>
  /** Called when a write fails (a broken pipe, for instance) or the server throws. */
  reportError?(error: unknown): void
  /**
   * Longest accepted line, in characters (default {@link DEFAULT_MAX_MESSAGE_LENGTH}, 16 Mi).
   * A longer line is discarded as it streams in and answered with `-32600`.
   */
  maxMessageLength?: number
}

export interface StdioOptions {
  /** Docs tree for the documentation tools (default: `--docs` argument, then `BOTMESH_DOCS_DIR`, then the deprecated `BOTWA_DOCS_DIR`). */
  docsDir?: string
  /** argv to parse when `docsDir` is absent (default: `process.argv.slice(2)`). */
  argv?: readonly string[]
}

/** `--docs <dir>` / `--docs=<dir>` from a command line. */
export function docsDirFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === '--docs') {
      const next = argv[index + 1]
      return next !== undefined && next !== '' && !next.startsWith('-') ? next : undefined
    }
    if (arg.startsWith('--docs=')) {
      const value = arg.slice('--docs='.length)
      return value === '' ? undefined : value
    }
  }
  return undefined
}

/** Default {@link ServeOptions.maxMessageLength}: 16 Mi characters per line. */
export const DEFAULT_MAX_MESSAGE_LENGTH = 16 * 1024 * 1024

/**
 * Serve messages from `input` until it ends. Messages are handled one at a time so the
 * responses cannot interleave; a malformed line answers `-32700`, a line longer than
 * `maxMessageLength` answers `-32600`, a batch (a JSON array, MCP `2025-03-26`) answers an
 * array, and the session always continues.
 */
export async function serveStream(input: AsyncIterable<string | Uint8Array>, options: ServeOptions): Promise<void> {
  const maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH
  if (!(maxMessageLength > 0)) throw new RangeError('maxMessageLength must be a positive number of characters')

  const write = async (line: string): Promise<void> => {
    try {
      await options.write(line)
    } catch (error) {
      options.reportError?.(error)
    }
  }

  // A server that throws must not end the session: answer -32603 (requests only).
  const handle = async (message: unknown): Promise<JsonRpcResult | JsonRpcFailure | null> => {
    try {
      return await options.server.handle(message)
    } catch (error) {
      options.reportError?.(error)
      const id = idOf(message)
      return id === null ? null : errorResponse(id, RPC_ERROR.internalError, 'internal error')
    }
  }

  const handleLine = async (line: string | OversizedLine): Promise<void> => {
    if (typeof line !== 'string') {
      await write(encodeMessage(errorResponse(null, RPC_ERROR.invalidRequest, `message exceeds ${maxMessageLength} characters`)))
      return
    }
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      await write(encodeMessage(errorResponse(null, RPC_ERROR.parseError, 'invalid JSON')))
      return
    }
    if (Array.isArray(message)) {
      if (message.length === 0) {
        await write(encodeMessage(errorResponse(null, RPC_ERROR.invalidRequest, 'invalid JSON-RPC request: empty batch')))
        return
      }
      const responses: Array<JsonRpcResult | JsonRpcFailure> = []
      for (const entry of message) {
        const response = await handle(entry)
        if (response !== null) responses.push(response)
      }
      if (responses.length > 0) await write(encodeMessage(responses))
      return
    }
    const response = await handle(message)
    if (response !== null) await write(encodeMessage(response))
  }

  const decoder = new LineDecoder(maxMessageLength)
  // Streaming UTF-8 decode: a multi-byte character split across two chunks stays intact.
  const utf8 = new TextDecoder('utf-8')
  for await (const chunk of input) {
    const text = typeof chunk === 'string' ? chunk : utf8.decode(chunk, { stream: true })
    for (const line of decoder.push(text)) await handleLine(line)
  }
  const tail = utf8.decode()
  if (tail) for (const line of decoder.push(tail)) await handleLine(line)
  for (const line of decoder.flush()) await handleLine(line)
}

/** The docs directory from the environment: `BOTMESH_DOCS_DIR`, then the deprecated `BOTWA_DOCS_DIR`. */
export function docsDirFromEnv(env: Record<string, string | undefined>): string | undefined {
  return env.BOTMESH_DOCS_DIR || env.BOTWA_DOCS_DIR || undefined
}

/** What `botmesh-mcp --help` prints. */
const USAGE = `Usage: botmesh-mcp [--docs <dir>]

MCP server (stdio) for botmesh: validates, analyzes, migrates and diffs JSON flow documents.
Register it in your MCP client as a stdio server; stdout is the protocol channel.

Options:
  --docs <dir>   Markdown docs tree for docs_search / docs_page (or BOTMESH_DOCS_DIR)
  -h, --help     Show this help and exit
  -v, --version  Print the version and exit
`

/**
 * Run the server over the process streams (what `bin.ts` calls). `--help` / `-h` and
 * `--version` / `-v` print to stdout and return without serving.
 */
export async function runStdio(options: StdioOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`)
    return
  }
  const docsDir = options.docsDir ?? docsDirFromArgv(argv) ?? docsDirFromEnv(process.env)
  const server = createMcpServer(docsDir !== undefined && docsDir !== '' ? { docsDir } : {})
  const tools: readonly McpToolInfo[] = server.tools
  process.stderr.write(`botmesh-mcp: ${tools.length} tool(s)${docsDir ? `, docs ${docsDir}` : ' (docs tools off: pass --docs <dir>)'}\n`)
  if (docsDir && !isDirectory(docsDir)) {
    process.stderr.write(`botmesh-mcp: warning: docs directory not found: ${docsDir} (docs_search / docs_page will fail)\n`)
  }

  process.stdin.setEncoding('utf8')
  await serveStdioStreams(server, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
}

/** The protocol channel: the subset of a writable stream {@link serveStdioStreams} uses. */
export interface StdioOutput {
  write(chunk: string): boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'drain' | 'close', listener: () => void): unknown
  once(event: 'drain', listener: () => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'drain' | 'close', listener: () => void): unknown
  /** Bytes still queued; while non-zero, a late `'error'` is still absorbed after serving ends. */
  readonly writableLength?: number
}

/** The streams {@link serveStdioStreams} serves over (the process streams in {@link runStdio}). */
export interface StdioStreams {
  stdin: AsyncIterable<string | Uint8Array>
  stdout: StdioOutput
  /** Diagnostics only: nothing but protocol messages goes to `stdout`. */
  stderr: { write(chunk: string): unknown }
}

/**
 * Serve `server` over a stdio-like stream pair until `stdin` ends. A client that goes away
 * closes the pipe: an `'error'` (EPIPE) or `'close'` on `stdout` stops further writes instead
 * of crashing the process, and a write waiting for `'drain'` is released. While output is still
 * queued when the input ends, the error listener stays attached so a late EPIPE is absorbed.
 */
export async function serveStdioStreams(server: McpServer, streams: StdioStreams): Promise<void> {
  const { stdin, stdout, stderr } = streams
  let closed = false
  let wake: (() => void) | undefined
  const onStdoutError = (error: Error): void => {
    if (!closed) stderr.write(`botmesh-mcp: stdout closed: ${error.message}
`)
    closed = true
    wake?.()
  }
  const onStdoutClose = (): void => {
    closed = true
    wake?.()
  }
  stdout.on('error', onStdoutError)
  stdout.on('close', onStdoutClose)

  try {
    await serveStream(stdin, {
      server,
      write(line) {
        if (closed) return
        if (stdout.write(`${line}
`)) return
        // Respect backpressure: the pipe is full, wait for it to drain (or to break).
        return new Promise<void>((resolve) => {
          const onDrain = (): void => { wake?.() }
          wake = () => { wake = undefined; stdout.off('drain', onDrain); resolve() }
          stdout.once('drain', onDrain)
        })
      },
      reportError(error) {
        stderr.write(`botmesh-mcp: ${error instanceof Error ? error.message : String(error)}
`)
      },
    })
  } finally {
    stdout.off('close', onStdoutClose)
    // Queued output can still fail asynchronously (EPIPE after the client left): keep the
    // listener then, or the late 'error' would be an uncaught exception.
    if (closed || (stdout.writableLength ?? 0) === 0) stdout.off('error', onStdoutError)
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
