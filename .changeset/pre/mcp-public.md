---
'@botmesh/mcp': major
---

First public release of `@botmesh/mcp`, the stdio MCP server for botmesh flow documents: `npx -y @botmesh/mcp` (bin `botmesh-mcp`).

- **API freeze (main entry: 40 names before, 19 after).** The main entry keeps what a host needs to embed or run the server: `createMcpServer`, `serveStream`, `runStdio`, `MCP_PROTOCOL_VERSION(S)`, `MCP_INSTRUCTIONS`, `MCP_SERVER_NAME`, `MCP_SERVER_VERSION`, `EXAMPLE_FLOW_DOCUMENT` and their types. The JSON-RPC framing (`LineDecoder`, `encodeMessage`, `errorResponse`…), the tool catalogue (`createTools`, `stepKindsOf`) and the docs search (`searchDocs`, `readDocPage`…) moved to the new `@botmesh/mcp/internal` entry (no semver).
- `botmesh-mcp --help` / `-h` prints the usage and `--version` / `-v` the version, both without starting the server.
- The reported server version is read from `package.json`, so it can no longer drift after a release.
- `EXAMPLE_FLOW_DOCUMENT` is in English and deep-frozen; `MCP_PROTOCOL_VERSIONS` is frozen.
