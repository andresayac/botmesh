# @botmesh/mcp

**Model Context Protocol** server (stdio) for [botmesh](https://andresayac.github.io/botmesh/). It gives an AI coding agent or an editor the project's deterministic pieces, so a [code-free flow document](https://www.npmjs.com/package/@botmesh/flow-schema) can be written, validated, compiled, drawn, linted, migrated and diffed **without starting a bot**: no phone, no credentials, no network.

Every tool is a function of its arguments. The server never evaluates code, never writes to disk and has no third-party dependencies: the JSON-RPC transport is implemented in the package.

## Install

Nothing to install up front: MCP clients start it with `npx`.

```bash
npx -y @botmesh/mcp --help
```

Node.js 22 or later. It depends on `@botmesh/core` and `@botmesh/flow-schema`. To embed the server in your own host, `pnpm add @botmesh/mcp`.

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older prerelease. Use the prerelease dist-tag to get the build these docs describe: `npx -y @botmesh/mcp@beta` (and `@botmesh/mcp@beta` in the client configurations below) during the beta (`npm view @botmesh/mcp dist-tags` lists the tags). Once stable, the plain name works.

## Quick start: register it in your client

**Claude Code**

```bash
claude mcp add botmesh -- npx -y @botmesh/mcp
```

Or share it with the project in `.mcp.json`:

```json
{ "mcpServers": { "botmesh": { "command": "npx", "args": ["-y", "@botmesh/mcp"] } } }
```

**Cursor** (`.cursor/mcp.json`) and **Claude Desktop** (`claude_desktop_config.json`) use the same `mcpServers` shape.

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "botmesh": { "type": "stdio", "command": "npx", "args": ["-y", "@botmesh/mcp"] } } }
```

Then ask your agent to "validate this flow document with botmesh" or "draw the graph of this flow".

## Tools

| Tool | What it does |
| --- | --- |
| `flow_validate` | Validates against the versioned schema (draft 2020-12) and returns every problem with its JSON Pointer path. |
| `flow_analyze` | Validates, compiles, draws the graph (Mermaid or JSON) and returns the core `lintFlows` diagnostics in one call. Accepts `subflows` (id → document). |
| `flow_migrate` | Chains the known migrations (a document without `version` is read as 0) and returns the migrated document and the applied steps. |
| `flow_diff` | Structural diff of two valid documents, with each side's digest. |
| `flow_digest` | `sha256` over canonical JSON (key order does not change it) and the version label `publishFlow` uses. |
| `flow_schema` | The JSON Schema, its structural limits and the accepted step kinds. |
| `flow_example` | A canonical document that validates and lints clean. |
| `docs_search` | Searches the botmesh guides (English and Spanish). Only with a docs directory (see options). |
| `docs_page` | Returns one guide page by its relative path. Only with a docs directory. |

An invalid document is a **successful** call with `valid: false` and the `issues`; `isError` is reserved for a bad request (missing or mistyped arguments, a version that cannot be migrated, a path outside the docs directory).

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--docs <dir>` / `--docs=<dir>` | off | A local Markdown tree (for example the `docs/` folder of a clone of the botmesh repository) for `docs_search` / `docs_page`. Without it those two tools are not advertised. |
| `BOTMESH_DOCS_DIR` | unset | Same as `--docs`, from the environment. |
| `-h`, `--help` | | Prints the usage and exits. |
| `-v`, `--version` | | Prints the version and exits. |

The guides are not bundled in the package; the flow tools work without them.

## Embed it

```ts
import { createMcpServer, serveStream } from '@botmesh/mcp'

const server = createMcpServer({ docsDir: 'docs' })
await serveStream(process.stdin, { server, write: (line) => process.stdout.write(`${line}\n`) })
```

| Export | What it is for |
| --- | --- |
| `createMcpServer(options?)` | A server: `tools` and `handle(message)` (returns the response, or `null` for a notification). Options: `docsDir`, `name`, `version`, `instructions`. |
| `serveStream(input, { server, write, reportError? })` | Serves newline-delimited JSON-RPC from any async iterable. |
| `runStdio(options?)` | What the `botmesh-mcp` bin runs: `process.stdin` / `process.stdout`, diagnostics on stderr. |
| `MCP_PROTOCOL_VERSIONS`, `MCP_PROTOCOL_VERSION` | Supported revisions (`2025-06-18`, `2025-03-26`, `2024-11-05`) and the one answered to an unknown request. |
| `MCP_SERVER_NAME`, `MCP_SERVER_VERSION`, `MCP_INSTRUCTIONS`, `EXAMPLE_FLOW_DOCUMENT` | Server identity, the `initialize` instructions and the example document. |

`@botmesh/mcp/internal` holds the JSON-RPC framing, the tool catalogue and the docs search. It has **no semver guarantee**.

## Troubleshooting

- **The client shows the server as failed or times out:** run `npx -y @botmesh/mcp --version` in a terminal first, so npm downloads it outside the client's start-up timeout. On Windows, clients that cannot start `npx` directly need `"command": "cmd", "args": ["/c", "npx", "-y", "@botmesh/mcp"]`.
- **No `docs_search` tool:** pass `--docs <dir>` (or `BOTMESH_DOCS_DIR`) pointing at a local Markdown tree.
- **Garbage in the protocol stream:** stdout is the protocol channel. If you wrap the server, write logs to stderr only.

## Links

- [MCP server guide](https://andresayac.github.io/botmesh/guide/mcp) · [JSON flow schema](https://andresayac.github.io/botmesh/guide/flow-schema)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/mcp/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/mcp) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver (except `@botmesh/mcp/internal`).
