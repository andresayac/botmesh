import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readDocPage } from '../src/docs.js'
import { createMcpServer } from '../src/server.js'
import { serveStream } from '../src/stdio.js'

const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })

describe('serveStream with byte chunks', () => {
  it('reassembles a multi-byte character split across two chunks', async () => {
    const line = `${JSON.stringify({ jsonrpc: '2.0', id: 'ñ🤖', method: 'ping' })}\n`
    const bytes = Buffer.from(line, 'utf8')
    const cut = bytes.indexOf(Buffer.from('ñ', 'utf8')) + 1 // in the middle of "ñ"
    const written: string[] = []
    await serveStream(
      (async function* stream() { yield new Uint8Array(bytes.subarray(0, cut)); yield new Uint8Array(bytes.subarray(cut)) })(),
      { server: createMcpServer(), write: (out) => { written.push(out) } },
    )
    expect(written.map((out) => JSON.parse(out).id)).toEqual(['ñ🤖'])
  })
})

describe('readDocPage and links', () => {
  it('refuses a page reached through a link that leaves the docs directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'botmesh-mcp-'))
    dirs.push(base)
    const root = join(base, 'docs')
    const outside = join(base, 'private')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, 'secret.md'), 'TOKEN=abc')
    await writeFile(join(root, 'ok.md'), '# ok')
    // A junction needs no privileges on Windows; elsewhere a plain directory symlink.
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(readDocPage(root, 'linked/secret.md')).rejects.toThrow(/escapes the docs directory/)
    expect((await readDocPage(root, 'ok.md')).text).toBe('# ok')
  })
})

describe('server.handle fuzz', () => {
  it('never throws and always answers requests with a well-formed JSON-RPC message', async () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32 }
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const values: unknown[] = [null, 0, -1, 1.5, '', 'x', [], {}, { a: 1 }, true, 'ñ🤖', { version: 1, id: 'x', trigger: 'x', steps: [{ kind: 'say', text: 'hi' }] }]
    const server = createMcpServer()
    for (let i = 0; i < 2000; i++) {
      const message: Record<string, unknown> = {}
      if (rnd() < 0.9) message.jsonrpc = pick(['2.0', '2.0', '1.0', 2])
      if (rnd() < 0.8) message.id = pick([1, 'a', null, {}, [], 2.5])
      if (rnd() < 0.95) message.method = pick(['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', '', 'x', 'notifications/initialized'])
      if (rnd() < 0.8) {
        message.params = pick([
          undefined, null, [], 'p',
          { name: pick(['flow_validate', 'flow_analyze', 'flow_migrate', 'flow_diff', 'flow_digest', 'flow_schema', 'flow_example', 'nope', '', 5]), arguments: pick([undefined, null, [], {}, { document: pick(values), left: pick(values), right: pick(values), subflows: pick(values), target: pick(values), format: pick(['json', 'mermaid', 1]) }]) },
          { protocolVersion: pick(['2025-06-18', '1999-01-01', 5]) },
        ])
      }
      const response = await server.handle(rnd() < 0.05 ? pick(values) : message)
      if (response === null) continue
      expect(response.jsonrpc).toBe('2.0')
      expect('result' in response || 'error' in response).toBe(true)
      expect(() => JSON.stringify(response)).not.toThrow()
    }
  })
})
