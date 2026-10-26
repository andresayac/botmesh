---
'@botmesh/mcp': patch
---

Protocol conformance and hardening:

- `tools/call` arguments are checked against the advertised `inputSchema` (unknown keys, missing required keys, enums, ranges, nesting deeper than 64 levels) and fail as a tool error that names the problem, instead of being ignored or overflowing the stack.
- Responses sent by the client are no longer answered; JSON-RPC batches (revision `2025-03-26`) are answered with an array.
- `serveStream` bounds each line (`maxMessageLength`, default `DEFAULT_MAX_MESSAGE_LENGTH`), answers `-32603` when the server throws and keeps serving.
- `botmesh-mcp` no longer crashes with an unhandled `EPIPE` when the client closes the pipe, and warns when the `--docs` directory does not exist.
- Docs tools answer `page not found: <relative path>` / `docs directory not found` instead of raw `ENOENT` errors with absolute paths (and no longer report a missing page as an escape on a lowercase Windows drive).
- Tools carry read-only `annotations`; the `initialize` instructions state the current flow document version (2).
