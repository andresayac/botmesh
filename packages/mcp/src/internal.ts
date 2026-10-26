/**
 * `@botmesh/mcp/internal` — the pieces the server is built from: the newline-delimited
 * JSON-RPC 2.0 framing, the tool catalogue, the documentation search and the stdio stream
 * wiring (`serveStdioStreams`).
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
export type { JsonRpcRequest, OversizedLine } from './protocol.js'

export { MAX_ARGUMENT_DEPTH, checkArguments } from './arguments.js'

export { createTools, stepKindsOf } from './tools.js'
export type { ToolDefinition, ToolOutput } from './tools.js'

export { loadSections, markdownFiles, parseSections, readDocPage, searchDocs, searchSections } from './docs.js'
export type { DocHit, DocSection } from './docs.js'

export { docsDirFromArgv, docsDirFromEnv, serveStdioStreams } from './stdio.js'
export type { StdioOutput, StdioStreams } from './stdio.js'
