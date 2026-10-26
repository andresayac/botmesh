/**
 * Protocol conformance and input hardening found by the release test of `@botmesh/mcp`:
 * responses sent by a client are never answered, JSON-RPC batches (2025-03-26) work, tool
 * arguments are checked against the advertised `inputSchema`, deep or oversized input fails
 * with a clear message instead of a stack overflow or an unbounded buffer, and docs errors
 * never leak absolute paths.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { FLOW_DOCUMENT_VERSION } from '@botmesh/flow-schema'

import { searchSections } from '../src/docs.js'
import { LineDecoder } from '../src/protocol.js'
import { MCP_INSTRUCTIONS, createMcpServer, type McpServer } from '../src/server.js'
import { serveStream } from '../src/stdio.js'

const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })

async function tempDocs(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'botmesh-mcp-conf-'))
  dirs.push(root)
  await mkdir(join(root, 'guide'))
  await writeFile(join(root, 'guide', 'flows.md'), '# Flows\n\nDurability keeps flows alive.\n')
  return root
}

const server = createMcpServer()

async function call(name: string, args: unknown, instance: McpServer = server): Promise<{ text: string; isError?: boolean }> {
  const response = await instance.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as Record<string, any>
  if (response.error) throw new Error(`unexpected JSON-RPC error: ${response.error.message}`)
  return { text: response.result.content[0].text, ...(response.result.isError ? { isError: true } : {}) }
}

const valid = { version: FLOW_DOCUMENT_VERSION, id: 'a', trigger: 'hi', steps: [{ kind: 'say', text: 'x' }] }

async function serve(chunks: readonly string[], instance: McpServer = server, options: { maxMessageLength?: number } = {}): Promise<unknown[]> {
  const written: string[] = []
  await serveStream(
    (async function* stream() { for (const chunk of chunks) yield chunk })(),
    { server: instance, write: (line) => { written.push(line) }, ...options },
  )
  return written.map((line) => JSON.parse(line) as unknown)
}

describe('messages that are not requests', () => {
  it('never answers a JSON-RPC response sent by the client (it would collide with the client ids)', async () => {
    expect(await server.handle({ jsonrpc: '2.0', id: 5, result: {} })).toBeNull()
    expect(await server.handle({ jsonrpc: '2.0', id: 6, error: { code: -1, message: 'x' } })).toBeNull()
  })
})

describe('JSON-RPC batches', () => {
  it('answers a batch with an array of responses, in order, skipping notifications', async () => {
    const out = await serve([`${JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'nope' },
    ])}\n`])
    expect(out).toHaveLength(1)
    const batch = out[0] as Array<Record<string, any>>
    expect(Array.isArray(batch)).toBe(true)
    expect(batch.map((entry) => entry.id)).toEqual([1, 'b'])
    expect(batch[1]!.error.code).toBe(-32601)
  })

  it('writes nothing for a batch of notifications and rejects an empty batch', async () => {
    expect(await serve([`${JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }])}\n`])).toEqual([])
    const empty = await serve(['[]\n'])
    expect(empty).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32600, message: expect.stringMatching(/empty batch/) } }])
  })
})

describe('transport robustness', () => {
  it('answers -32603 when the server itself throws, and keeps serving', async () => {
    const failing: McpServer = {
      tools: [],
      handle: async (message) => {
        if ((message as { method?: string }).method === 'boom') throw new Error('kaput')
        return { jsonrpc: '2.0', id: (message as { id: number }).id, result: {} }
      },
    }
    const out = await serve([
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'boom' })}\n`,
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`,
    ], failing)
    expect(out).toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'internal error' } },
      { jsonrpc: '2.0', id: 2, result: {} },
    ])
  })

  it('rejects a line longer than maxMessageLength and keeps the session alive', async () => {
    const huge = `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"${'a'.repeat(5000)}"}}`
    const out = await serve([huge.slice(0, 2000), huge.slice(2000), '\n', `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`], server, { maxMessageLength: 1000 })
    expect(out).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: expect.stringMatching(/exceeds 1000 characters/) } },
      { jsonrpc: '2.0', id: 2, result: {} },
    ])
  })

  it('reassembles a long line from many chunks in linear time', () => {
    const decoder = new LineDecoder()
    const chunk = 'x'.repeat(64 * 1024)
    const started = performance.now()
    for (let index = 0; index < 400; index++) expect(decoder.push(chunk)).toEqual([])
    const lines = decoder.push('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.length).toBe(400 * 64 * 1024)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('tool arguments are checked against the advertised inputSchema', () => {
  it('rejects an unknown argument naming the accepted ones', async () => {
    const result = await call('flow_validate', { doc: valid })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/unknown argument "doc"/)
    expect(result.text).toMatch(/"document"/)
  })

  it('rejects a format or direction outside the enum', async () => {
    const format = await call('flow_analyze', { document: valid, format: 'svg' })
    expect(format).toMatchObject({ isError: true })
    expect(format.text).toMatch(/"format" must be one of "mermaid", "json"/)
    const direction = await call('flow_analyze', { document: valid, direction: 'XX' })
    expect(direction).toMatchObject({ isError: true })
    expect(direction.text).toMatch(/"direction" must be one of/)
  })

  it('rejects a migration target newer than the supported version', async () => {
    const result = await call('flow_migrate', { document: { id: 'a' }, target: FLOW_DOCUMENT_VERSION + 1 })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(new RegExp(`"target" must be at most ${FLOW_DOCUMENT_VERSION}`))
  })

  it('rejects a docs_search limit outside 1..25', async () => {
    const docs = createMcpServer({ docsDir: await tempDocs() })
    for (const limit of [-5, 0, 2.5, 100, '3']) {
      const result = await call('docs_search', { query: 'flows', limit }, docs)
      expect(result.isError, String(limit)).toBe(true)
      expect(result.text).toMatch(/"limit"/)
    }
    expect((await call('docs_search', { query: 'flows', limit: 25 }, docs)).isError).toBeUndefined()
  })

  it('fails a deeply nested argument with a clear message instead of a stack overflow', async () => {
    const deep = JSON.parse(`{"version":2,"id":"a","trigger":"x","steps":[${'{"kind":"condition","if":"a","then":['.repeat(20_000)}${']}'.repeat(20_000)}]}`) as unknown
    for (const tool of ['flow_validate', 'flow_analyze', 'flow_migrate', 'flow_digest']) {
      const result = await call(tool, { document: deep })
      expect(result.isError, tool).toBe(true)
      expect(result.text, tool).toMatch(/nested deeper than \d+ levels/)
      expect(result.text, tool).not.toMatch(/call stack/)
    }
  })

  it('does not resolve a subflow through an inherited property', async () => {
    const document = { version: FLOW_DOCUMENT_VERSION, id: 'a', trigger: 'x', steps: [{ kind: 'subflow', flowId: 'toString' }] }
    const result = JSON.parse((await call('flow_analyze', { document, subflows: {} })).text) as { valid: boolean; issues: Array<{ message: string }> }
    expect(result.valid).toBe(false)
    expect(result.issues[0]!.message).toMatch(/cannot be resolved/)
  })
})

describe('tool annotations', () => {
  it('marks every tool read-only, idempotent and closed-world', () => {
    for (const tool of createMcpServer({ docsDir: 'docs' }).tools) {
      expect(tool.annotations, tool.name).toEqual({ title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
    }
  })
})

describe('docs errors', () => {
  it('answers a missing page with its relative path, never the absolute one', async () => {
    const root = await tempDocs()
    const result = await call('docs_page', { path: 'guide/nope.md' }, createMcpServer({ docsDir: root }))
    expect(result.isError).toBe(true)
    expect(result.text).toBe('page not found: guide/nope.md')
  })

  it.runIf(process.platform === 'win32')('reports a missing page as not found when the root uses a lowercase drive', async () => {
    const root = await tempDocs()
    const lower = root.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
    const result = await call('docs_page', { path: 'guide/nope.md' }, createMcpServer({ docsDir: lower }))
    expect(result.text).toBe('page not found: guide/nope.md')
    expect((await call('docs_page', { path: 'guide/flows.md' }, createMcpServer({ docsDir: lower }))).isError).toBeUndefined()
  })

  it('says which docs directory is missing', async () => {
    const result = await call('docs_search', { query: 'x' }, createMcpServer({ docsDir: join(tmpdir(), 'botmesh-mcp-missing-dir') }))
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/^docs directory not found: .*botmesh-mcp-missing-dir/)
    expect(result.text).not.toMatch(/ENOENT/)
  })

  it('never cuts a snippet in the middle of a surrogate pair', () => {
    const line = `durability! ${'🤖'.repeat(300)}`
    const [hit] = searchSections([{ path: 'a.md', title: 'A', heading: 'A', body: line }], 'durability')
    expect(hit!.snippet.endsWith('…')).toBe(true)
    expect(hit!.snippet).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('instructions', () => {
  it('state the current flow document version', () => {
    expect(MCP_INSTRUCTIONS).toContain(`version ${FLOW_DOCUMENT_VERSION}`)
    expect(MCP_INSTRUCTIONS).not.toMatch(/data: version 1,/)
  })
})

describe('serveStream fuzz', () => {
  it('survives random chunks (garbage, batches, huge lines) and only writes well-formed JSON-RPC', async () => {
    let seed = 42
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32 }
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const pieces = [
      '{"jsonrpc":"2.0","id":1,"method":"ping"}', '[{"jsonrpc":"2.0","id":2,"method":"tools/list"}]', '[]', '[1,2]', 'null',
      '{"jsonrpc":"2.0","id":3,"result":{}}', '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"flow_example"}}',
      '{', '}', '"', '\\', '\r', '\n', '\r\n', 'ñ🤖', '\u0000', 'x'.repeat(3000), '[[[[[[[[', ']]]]',
    ]
    for (let round = 0; round < 50; round++) {
      const chunks = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => pick(pieces))
      const written: string[] = []
      await serveStream(
        (async function* stream() { for (const chunk of chunks) yield rnd() < 0.5 ? chunk : new TextEncoder().encode(chunk) })(),
        { server, write: (line) => { written.push(line) }, maxMessageLength: 2048 },
      )
      for (const line of written) {
        expect(line).not.toContain('\n')
        const parsed = JSON.parse(line) as unknown
        for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
          expect((message as { jsonrpc: string }).jsonrpc).toBe('2.0')
          expect('result' in (message as object) || 'error' in (message as object)).toBe(true)
        }
      }
    }
  })
})
