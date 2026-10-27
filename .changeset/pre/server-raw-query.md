---
"@botmesh/server": patch
"@botmesh/twilio": patch
---

The request URL handed to `ingest()` (third argument) now carries the query string exactly as received instead of `URLSearchParams.toString()`, which re-encoded it. `IngressRequest` takes an optional `rawQuery` (filled by `createNodeHandler`, the Express/Fastify/Hono adapters and `createFetchHandler`; custom adapters that omit it keep the old behaviour) and `splitUrl()` returns it. Before, `TwilioProvider` with `webhookPath` behind `@botmesh/server` answered 403 to every correctly signed request whose console URL had a query such as `?tenant=a%20b`, `?flag`, `?next=/x` or `?t=~x`.
