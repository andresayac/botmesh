# @botmesh/otel

OpenTelemetry for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core): a `BotTracer` that turns the bot's spans into OpenTelemetry spans (Jaeger, Grafana Tempo, any OTLP backend), latency and token histograms derived from those spans, and a bridge that publishes `bot.metrics()` as OpenTelemetry metrics.

No message bodies, prompts, tool arguments or error messages reach a span, and chat, user and message ids are HMAC-hashed by default: that policy lives in the core, this package only forwards what the core emits.

## Install

```bash
pnpm add @botmesh/otel @opentelemetry/api
# plus an SDK and an exporter, for example:
pnpm add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

Node.js 22 or later, ESM only. `@opentelemetry/api` (`^1.9`) is an optional peer dependency loaded lazily: without it the package still imports, and `createOtelTracer()` rejects with a message that says what to install. Its type declarations name `@opentelemetry/api` types (`TracerProvider`, `MeterProvider`), so a TypeScript project needs it installed.

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/otel@beta` during the beta (`npm view @botmesh/otel dist-tags` lists the tags). Once stable, the plain command above works.

## Quick start

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Bot } from '@botmesh/core'
import { createOtelTracer, otelMetricsPlugin } from '@botmesh/otel'

const sdk = new NodeSDK({ serviceName: 'my-bot', traceExporter: new OTLPTraceExporter() })
sdk.start()

const bot = new Bot({
  provider,
  telemetry: { tracer: await createOtelTracer(), idKey: process.env.TRACE_ID_KEY },
})
bot.plug(otelMetricsPlugin())
```

Spans: `bot.inbound` → `bot.persist` / `bot.dispatch` → `bot.handler` → `bot.conversation.turn` → `bot.pace` → `bot.send`, plus one root `bot.lifecycle` span per start/stop step, one root `bot.task` span per scheduled task run, and `chat {model}`, `execute_tool {name}` and `bot.ai.retrieve` from [`@botmesh/ai`](https://github.com/andresayac/botmesh/tree/main/packages/ai). The full span catalogue is in the [tracing guide](https://andresayac.github.io/botmesh/guide/tracing).

## Tracer

| Function | When to use it |
| --- | --- |
| `createOtelTracer(options?)` | The usual one: loads `@opentelemetry/api` and resolves to the tracer. |
| `otelTracer({ api, ...options })` | Synchronous, with the API module injected (`import * as api from '@opentelemetry/api'`); handy with bundlers and in tests. |
| `lazyOtelTracer(options?)` | Usable at once, for a `new Bot()` built at import time: spans are no-ops until the API loads. A load failure never throws into the bot; it rejects `tracer.ready` (log it from there). |
| `loadOtelApi()` | Imports `@opentelemetry/api` with the install hint on failure. |

Options (`OtelTracingOptions`):

| Option | Default | What it does |
| --- | --- | --- |
| `api` | lazy import | The `@opentelemetry/api` module. |
| `tracerProvider` | the global one | `api.trace.getTracerProvider()`, set by the SDK. |
| `tracerName` | `'@botmesh/otel'` | Instrumentation scope name. |
| `spanMetrics` | `true` | Histograms derived from finished spans, recorded whether or not the span was sampled: `botmesh.inbound.duration`, `botmesh.dispatch.duration`, `botmesh.queue.wait`, `botmesh.send.duration`, `botmesh.lifecycle.duration`, `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`. Only low-cardinality attributes (kinds, stages, outcomes, provider and model names). `false` turns them off; `{ meterProvider, prefix }` changes where they go. |

## Metrics

`otelMetricsPlugin(options?)` (or `registerOtelMetrics(bot, options?)`, which resolves to an unregister function; `bridgeMetrics(api, bot, options?)` is the synchronous form) publishes `bot.metrics()` as counters and observable gauges: `botmesh.messages.inbound`, `botmesh.messages.outbound{result}`, `botmesh.dropped{reason}`, `botmesh.presence.skipped{kind}`, `botmesh.conversations.started|ended{outcome}|active`, `botmesh.flow.conversations.*{flow}`, `botmesh.triggered`, `botmesh.errors`, `botmesh.uptime`, and the `botmesh.conversation.duration{flow,outcome}` histogram.

| Option | Default | What it does |
| --- | --- | --- |
| `api` | lazy import | The `@opentelemetry/api` module (injected, the bridge registers at once). |
| `meterProvider` | the global one | Where the instruments are created. |
| `meterName` | `'@botmesh/otel'` | Instrumentation scope name. |
| `prefix` | `'botmesh'` | Metric name prefix (`'botwa'` keeps the names of the alpha releases). |
| `attributes` | none | Constant attributes added to every data point (besides `bot.id`). Keep them low-cardinality. |
| `perFlow` | `true` | Per-flow conversation counters. |
| `conversationDuration` | `true` | The `conversation:ended` duration histogram. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `@botmesh/otel needs @opentelemetry/api` | Install `@opentelemetry/api` (and an SDK). |
| No spans reach the backend | The SDK was started after the tracer was built, or it has no exporter. Start the SDK first, or use `lazyOtelTracer()`. |
| Spans but no histograms | No global meter provider is registered: give the SDK a metric reader, or pass `spanMetrics: { meterProvider }`. |
| Every chat id looks different after a restart | Ids are HMAC-hashed with a random key per process: set `telemetry.idKey` to a stable secret. |
| Dashboards from the alpha stopped matching | Metric names moved from `botwa.*` to `botmesh.*`; pass `prefix: 'botwa'` to keep the old ones. |

## Links

- [Tracing guide](https://andresayac.github.io/botmesh/guide/tracing) (Jaeger and Grafana Tempo examples, sampling, personal-data policy) · [Operations](https://andresayac.github.io/botmesh/guide/operations)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/otel/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/otel) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver. `@botmesh/otel/internal` (the span-metrics recorder) has no semver promise.
