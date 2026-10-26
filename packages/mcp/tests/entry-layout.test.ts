/**
 * Entry layout of `@botmesh/mcp` (public, semver on the main entry): the main entry holds what
 * a host needs to embed or run the server (`createMcpServer`, `serveStream`, `runStdio`, the
 * protocol revisions, the server identity and the canonical example document); the JSON-RPC
 * framing, the tool catalogue and the docs search live in `@botmesh/mcp/internal` (no semver).
 * Runtime names are pinned so growing an entry is a deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = [
  'EXAMPLE_FLOW_DOCUMENT', 'MCP_INSTRUCTIONS', 'MCP_PROTOCOL_VERSION', 'MCP_PROTOCOL_VERSIONS', 'MCP_SERVER_NAME',
  'MCP_SERVER_VERSION', 'createMcpServer', 'runStdio', 'serveStream',
]

const INTERNAL_VALUES = [
  'JSONRPC_VERSION', 'LineDecoder', 'RPC_ERROR', 'createTools', 'docsDirFromArgv', 'docsDirFromEnv', 'encodeMessage',
  'errorResponse', 'idOf', 'isJsonRpcRequest', 'loadSections', 'markdownFiles', 'parseSections', 'readDocPage',
  'resultResponse', 'searchDocs', 'searchSections', 'stepKindsOf',
]

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  private?: boolean
  bin: Record<string, string>
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
}

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen)
}

describe('@botmesh/mcp entry layout', () => {
  it('the main entry exports exactly the host-facing values', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES].sort())
  })

  it('/internal exports the framing, the tool catalogue and the docs search', () => {
    expect(Object.keys(internal).sort()).toEqual([...INTERNAL_VALUES].sort())
  })

  it('package.json is publishable: ./internal, the botmesh-mcp bin, public dependencies through workspace:^', () => {
    expect(pkg.private).toBeUndefined()
    expect(pkg.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
    expect(pkg.bin).toEqual({ 'botmesh-mcp': './lib/bin.js' })
    expect(pkg.dependencies).toEqual({ '@botmesh/core': 'workspace:^', '@botmesh/flow-schema': 'workspace:^' })
  })

  it('the bin starts with a node shebang', () => {
    expect(readFileSync(new URL('../src/bin.ts', import.meta.url), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true)
  })

  it('reports the package identity, read from package.json (never hard-coded)', () => {
    expect(main.MCP_SERVER_NAME).toBe(pkg.name)
    expect(main.MCP_SERVER_VERSION).toBe(pkg.version)
    expect(readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8')).not.toMatch(/=\s*'\d+\.\d+\.\d+/)
  })

  it('exported data is deep-frozen', () => {
    expect(isDeepFrozen(main.EXAMPLE_FLOW_DOCUMENT)).toBe(true)
    expect(isDeepFrozen(main.MCP_PROTOCOL_VERSIONS)).toBe(true)
  })
})
