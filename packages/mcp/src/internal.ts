/**
 * `@botmesh/mcp/internal` — the pieces the server is built from: the newline-delimited
 * JSON-RPC 2.0 framing, the tool catalogue and the documentation search.
 *
 * **No semver guarantee**: anything here can change in a minor or patch release. Hosts use the
 * main entry (`createMcpServer`, `serveStream`, `runStdio`) or the `botmesh-mcp` binary.
 *
 * @module @botmesh/mcp/internal
 */
export {
  JSONRPC_VERSION,
  LineDecoder,
  RPC_ERROR,
  encodeMessage,
  errorResponse,
  idOf,
  isJsonRpcRequest,
  resultResponse,
} from './protocol.js'
export type { JsonRpcRequest } from './protocol.js'

export { createTools, stepKindsOf } from './tools.js'
export type { ToolDefinition, ToolOutput } from './tools.js'

export { loadSections, markdownFiles, parseSections, readDocPage, searchDocs, searchSections } from './docs.js'
export type { DocHit, DocSection } from './docs.js'

export { docsDirFromArgv, docsDirFromEnv } from './stdio.js'
