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

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

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

Spans: `bot.inbound` → `bot.persist` / `bot.dispatch` → `bot.handler` → `bot.conversation.turn` → `bot.pace` → `bot.send`, plus one root `bot.lifecycle` span per start/stop step, one root `bot.task` span per scheduled task run, and `chat {model}`, `execute_tool {name}` and `bot.ai.retrieve` from [`@botmesh/ai`](https://github.com/andresayac/botmesh/tree/main/packages/ai). The full span catalogue is in the [tracing guide](https://botmesh.afaya.com.co/guide/tracing).

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
| `spanMetrics` | `true` | Histograms derived from finished spans, recorded whether or not the span was sampled: `botmesh.inbound.duration`, `botmesh.dispatch.duration`, `botmesh.queue.wait`, `botmesh.send.duration`, `botmesh.lifecycle.duration`, `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`. Only low-cardinality attributes (kinds, stages, outcomes, provider and model names). `false` turns them off; `{ meterProvider, prefix }` changes where they go. Bucket boundaries fit each unit (5 ms to 10 s for latencies, the GenAI semantic-convention buckets for model calls and tokens). |

## Metrics

`otelMetricsPlugin(options?)` (or `registerOtelMetrics(bot, options?)`, which resolves to an unregister function; `bridgeMetrics(api, bot, options?)` is the synchronous form) publishes `bot.metrics()` as counters and observable gauges: `botmesh.messages.inbound`, `botmesh.messages.outbound{result}`, `botmesh.dropped{reason}` (`duplicate`, `blocked`, `handoff`, plus `echo` with `echoFilter`), `botmesh.presence.skipped{kind}`, `botmesh.conversations.started|ended{outcome}|active`, `botmesh.flow.conversations.*{flow}`, `botmesh.triggered`, `botmesh.errors`, `botmesh.uptime`, and the `botmesh.conversation.duration{flow,outcome}` histogram.

| Option | Default | What it does |
| --- | --- | --- |
| `api` | lazy import | The `@opentelemetry/api` module (injected, the bridge registers at once). |
| `meterProvider` | the global one | Where the instruments are created. |
| `meterName` | `'@botmesh/otel'` | Instrumentation scope name. |
| `prefix` | `'botmesh'` | Metric name prefix (`'botwa'` keeps the names of the alpha releases). It must start with a letter and use only letters, digits, `.`, `_`, `-` or `/`; an invalid one throws. |
| `attributes` | none | Constant attributes added to every data point (besides `bot.id`). Keep them low-cardinality. |
| `perFlow` | `true` | Per-flow conversation counters. |
| `conversationDuration` | `true` | The `conversation:ended` duration histogram (buckets from 1 s to 1 day). |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `@botmesh/otel needs @opentelemetry/api` | Install `@opentelemetry/api` (and an SDK). |
| `... is not a valid metric name prefix` | The `prefix` (or `spanMetrics.prefix`) has a space or another character OpenTelemetry rejects in instrument names. Use something like `'acme.bot'`. |
| `metricReader` does not exist in `NodeSDKConfiguration` | Recent `@opentelemetry/sdk-node` releases take `metricReaders: [reader]` (an array). |
| No spans reach the backend | The SDK was started after the tracer was built, or it has no exporter. Start the SDK first, or use `lazyOtelTracer()`. |
| Spans but no histograms | No global meter provider is registered: give the SDK a metric reader, or pass `spanMetrics: { meterProvider }`. |
| Every chat id looks different after a restart | Ids are HMAC-hashed with a random key per process: set `telemetry.idKey` to a stable secret. |
| Dashboards from the alpha stopped matching | Metric names moved from `botwa.*` to `botmesh.*`; pass `prefix: 'botwa'` to keep the old ones. |

## Links

- [Tracing guide](https://botmesh.afaya.com.co/guide/tracing) (Jaeger and Grafana Tempo examples, sampling, personal-data policy) · [Operations](https://botmesh.afaya.com.co/guide/operations)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/otel/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/otel) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver. `@botmesh/otel/internal` (the span-metrics recorder) has no semver promise.
