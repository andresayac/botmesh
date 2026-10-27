# @botmesh/events

## 1.0.0-beta.0

### Major Changes

- 821d766: First public release of `@botmesh/server` (webhook ingress: raw body, size and time limits, concurrency cap, health endpoints, adapters for `node:http`, Express, Fastify and Hono), `@botmesh/events` (event envelopes, leased journals with fencing tokens, `EventWorker` with retries and a dead-letter state, and the bot durability backend in `@botmesh/events/durability`) and `@botmesh/otel` (OpenTelemetry tracer and `bot.metrics()` bridge for `@botmesh/core`). Their API is frozen and covered by semver from 1.0.0. Engine helpers left the main entries: `normalizePath`/`splitUrl` are in `@botmesh/server/internal` and `SpanMetrics`/`METRIC_SOURCE_KEYS` in `@botmesh/otel/internal` (no semver); the `__testing` seam of `@botmesh/events` is no longer exported, and its `AppendLogOptions` type is.

### Patch Changes

- 8582b8e: File journals reject an envelope JSON cannot hold (a `BigInt`, a circular reference) with a clear `TypeError` instead of keeping it in memory and failing every later write; what they read back is the JSON form they wrote. `MemoryEventJournal` stores a copy of the envelope. `EventWorker` validates its options and the journals validate their time, duration and limit arguments before changing anything, so a `NaN` can no longer strand a record. Every journal checks a record before storing it with the rules the file reader applies (string ids and keys, a finite `occurredAt`, an object `context`, the JSON form keeping the event identity, a string lease owner and channel), so nothing a journal accepts can stop it from reopening or strand it unclaimable; the reader also refuses damaged lease fields (`leaseUntil`, `fencingToken`, `owner`, `channel`, `completedAt`, `lastError`). `createEnvelope` names the missing field and rejects a non-finite `occurredAt`, a damaged snapshot or append-log entry is refused with an error naming the file and the bad record, and a closed `FileEventJournal` no longer applies a write in memory that it then rejects.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
