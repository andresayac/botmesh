---
"@botmesh/server": patch
---

Headers returned by `ingest()` as `{ status, body, headers }` now replace the ingress's own headers case-insensitively (`Content-Type` no longer yields `application/json; charset=utf-8, application/json`), and framing/hop-by-hop headers (`content-length`, `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `proxy-connection`, `te`, `trailer`) are dropped, so a result can no longer produce a response with conflicting lengths that clients reject.
