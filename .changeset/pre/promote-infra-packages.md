---
"@botmesh/server": major
"@botmesh/events": major
"@botmesh/otel": major
---

First public release of `@botmesh/server` (webhook ingress: raw body, size and time limits, concurrency cap, health endpoints, adapters for `node:http`, Express, Fastify and Hono), `@botmesh/events` (event envelopes, leased journals with fencing tokens, `EventWorker` with retries and a dead-letter state, and the bot durability backend in `@botmesh/events/durability`) and `@botmesh/otel` (OpenTelemetry tracer and `bot.metrics()` bridge for `@botmesh/core`). Their API is frozen and covered by semver from 1.0.0. Engine helpers left the main entries: `normalizePath`/`splitUrl` are in `@botmesh/server/internal` and `SpanMetrics`/`METRIC_SOURCE_KEYS` in `@botmesh/otel/internal` (no semver); the `__testing` seam of `@botmesh/events` is no longer exported, and its `AppendLogOptions` type is.
