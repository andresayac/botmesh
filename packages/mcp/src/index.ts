/**
 * `@botmesh/mcp` — an MCP server (Model Context Protocol) over stdio for botmesh.
 *
 * It exposes the project's pure, deterministic pieces to any MCP client (an AI coding
 * agent, an editor) so a flow document can be written, validated, compiled, rendered,
 * linted, migrated and diffed **without starting a bot**:
 *
 * - `flow_validate` / `flow_analyze` / `flow_migrate` / `flow_diff` / `flow_digest`
 * - `flow_schema` (the draft 2020-12 schema, its limits and the accepted step kinds)
 * - `flow_example` (a canonical document that validates and lints clean)
 * - `docs_search` / `docs_page` — only when a docs directory is configured
 *
 * No third-party dependencies, no network, no `eval`: the transport is newline-delimited
 * JSON-RPC 2.0 implemented in this package, and every tool is a function of its arguments.
 * Run it as the `botmesh-mcp` binary (`npx -y @botmesh/mcp`) or embed it with the API below.
 *
 * @example
 * ```ts
 * import { createMcpServer, serveStream } from '@botmesh/mcp'
 *
 * const server = createMcpServer({ docsDir: 'docs' })
 * await serveStream(process.stdin, { server, write: (line) => console.log(line) })
 * ```
 */
export {
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  createMcpServer,
} from './server.js'
export type { McpServer, McpServerOptions, McpToolInfo } from './server.js'

export { EXAMPLE_FLOW_DOCUMENT } from './tools.js'
export type { ToolContext } from './tools.js'

export type { JsonRpcErrorBody, JsonRpcFailure, JsonRpcId, JsonRpcResult } from './protocol.js'

export { runStdio, serveStream } from './stdio.js'
export type { ServeOptions, StdioOptions } from './stdio.js'

export { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './version.js'
