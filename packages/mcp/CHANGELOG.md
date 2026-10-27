# @botmesh/mcp

## 1.0.0-beta.0

### Major Changes

- 7e9c369: First public release of `@botmesh/mcp`, the stdio MCP server for botmesh flow documents: `npx -y @botmesh/mcp` (bin `botmesh-mcp`).
  
  - **API freeze (main entry: 40 names before, 19 after).** The main entry keeps what a host needs to embed or run the server: `createMcpServer`, `serveStream`, `runStdio`, `MCP_PROTOCOL_VERSION(S)`, `MCP_INSTRUCTIONS`, `MCP_SERVER_NAME`, `MCP_SERVER_VERSION`, `EXAMPLE_FLOW_DOCUMENT` and their types. The JSON-RPC framing (`LineDecoder`, `encodeMessage`, `errorResponse`…), the tool catalogue (`createTools`, `stepKindsOf`) and the docs search (`searchDocs`, `readDocPage`…) moved to the new `@botmesh/mcp/internal` entry (no semver).
  - `botmesh-mcp --help` / `-h` prints the usage and `--version` / `-v` the version, both without starting the server.
  - The reported server version is read from `package.json`, so it can no longer drift after a release.
  - `EXAMPLE_FLOW_DOCUMENT` is in English and deep-frozen; `MCP_PROTOCOL_VERSIONS` is frozen.

### Patch Changes

- 04841f6: Protocol conformance and hardening:
  
  - `tools/call` arguments are checked against the advertised `inputSchema` (unknown keys, missing required keys, enums, ranges, nesting deeper than 64 levels) and fail as a tool error that names the problem, instead of being ignored or overflowing the stack.
  - Responses sent by the client are no longer answered; JSON-RPC batches (revision `2025-03-26`) are answered with an array.
  - `serveStream` bounds each line (`maxMessageLength`, default `DEFAULT_MAX_MESSAGE_LENGTH`), answers `-32603` when the server throws and keeps serving.
  - `botmesh-mcp` no longer crashes with an unhandled `EPIPE` when the client closes the pipe (also when the error arrives after stdin ended with output still queued), no longer hangs waiting for `drain` when stdout closes, and warns when the `--docs` directory does not exist.
  - Docs tools answer `page not found: <relative path>` / `docs directory not found` instead of raw `ENOENT` errors with absolute paths (and no longer report a missing page as an escape on a lowercase Windows drive).
  - Tools carry read-only `annotations`; the `initialize` instructions state the current flow document version (2).
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
- Updated dependencies [7e9c369]
- Updated dependencies [cd0ea7b]
  - @botmesh/core@2.0.0-beta.4
  - @botmesh/flow-schema@1.0.0-beta.0
