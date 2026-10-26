---
'@botmesh/graph-core': patch
---

`readGraphResponse()` reads `Retry-After` safely: a negative value no longer produces a negative `retryAfterMs`, `0` means retry now, and the HTTP-date form is understood (garbage falls back to the code's default). `toGraphError()` maps error codes that arrive as digit strings, ignores a non-string `message`, and adds a hint to code `190` (invalid or expired access token) and `100`/`33` (the configured phone number, page or WABA id does not exist or is not reachable).
