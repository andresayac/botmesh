---
"@botmesh/server": patch
---

Release-test fixes: an `ingest()` status is used only when it is an integer 200-599 (a `1xx` code used to hang the client on `node:http` and throw on the fetch path), `205` no longer throws in `serveFetch`/Hono, `/readyz` answers `503` instead of rejecting when `bot.getConnectionState()` throws, absolute-form request targets are routed by their path, and configuration mistakes (missing `routes`, an unknown `body` mode, `healthPath` equal to `readyPath`, a `bot` without `getConnectionState()`, a timeout `setTimeout` would clamp to 1 ms, an invalid `close()` timeout) throw a `TypeError` naming the option. The docs now say that the request URL reaches `ingest()` as its third argument.
