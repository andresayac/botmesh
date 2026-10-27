# @botmesh/otel

## 1.0.0-beta.0

### Major Changes

- 821d766: First public release of `@botmesh/server` (webhook ingress: raw body, size and time limits, concurrency cap, health endpoints, adapters for `node:http`, Express, Fastify and Hono), `@botmesh/events` (event envelopes, leased journals with fencing tokens, `EventWorker` with retries and a dead-letter state, and the bot durability backend in `@botmesh/events/durability`) and `@botmesh/otel` (OpenTelemetry tracer and `bot.metrics()` bridge for `@botmesh/core`). Their API is frozen and covered by semver from 1.0.0. Engine helpers left the main entries: `normalizePath`/`splitUrl` are in `@botmesh/server/internal` and `SpanMetrics`/`METRIC_SOURCE_KEYS` in `@botmesh/otel/internal` (no semver); the `__testing` seam of `@botmesh/events` is no longer exported, and its `AppendLogOptions` type is.

### Patch Changes

- 27e56b5: `botmesh.dropped` now reports the echoes that `BotConfig.echoFilter` drops (`reason: 'echo'`), like the Prometheus exporter of the core already did. Without the filter nothing changes: no `echo` point is observed.
- e1f425e: Histograms get bucket boundaries that fit their unit (instrument advice): 5 ms to 10 s for the span-derived latencies, the GenAI semantic-convention buckets for `gen_ai.client.operation.duration` and `gen_ai.client.token.usage`, and 1 s to 1 day for `botmesh.conversation.duration`. Before, they used the SDK defaults (0 to 10000, meant for milliseconds), so every duration in seconds fell in the first bucket. Span metrics now honour `startTimeMs`/`endTimeMs` without mixing clocks: a span with no caller-given time is measured with the monotonic clock, and one with `startTimeMs` or `endTimeMs` reads both ends on the wall clock (`Date.now()`), so a wall-clock step never lands in a duration; a negative duration records 0. An invalid metric `prefix` (or `spanMetrics.prefix`) throws a clear `TypeError` instead of producing instruments the SDK only warns about, and `otelMetricsPlugin()` without an injected `api` logs a bridge that fails to register instead of raising an unhandled rejection. The guides use `metricReaders: [reader]`, which current `@opentelemetry/sdk-node` releases require.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
