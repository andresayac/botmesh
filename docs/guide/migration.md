# Upgrade to stable: dependencies

Step 2 of the [upgrade checklist](./stable-migration#upgrade-checklist). The
stable line updates the dependencies of the public packages and finishes the
`botwa` → `botmesh` rename. Each section says who is affected and what to do.

| Change | Who is affected | What to do |
| --- | --- | --- |
| [`botmesh_` metric names](#prometheus-metric-names-botmesh-prefix) | Dashboards and alerts on `botwa_*` | Rename the queries, or pass `{ prefix: 'botwa_' }` |
| [Environment variables](#environment-variables) | Scripts that set `BOTWA_*` | Rename (the old names are still read) |
| [`redis` is a peer dependency](#botmesh-redis-store-redis-is-a-peer-dependency) | `@botmesh/redis-store` users | Nothing, unless you typed clients with `NativeRedisClient` |
| [ffmpeg is no longer bundled](#botmesh-baileys-ffmpeg-is-no-longer-bundled) | Baileys bots that send voice notes | Install ffmpeg, or `ffmpeg-static` |
| [Graph API v26.0](#meta-providers-graph-api-v26-0) | Cloud API, Messenger, Instagram | Nothing, or pin `apiVersion` |
| [AI SDKs and default models](#botmesh-ai-sdks-and-default-models) | Gemini bots; bots without an explicit `model` | `pnpm add @google/genai`; set `model` |
| [Names that stay](#names-that-stay) | Everyone | Nothing: stored `botwa` keys and prefixes keep working |

## Prometheus metric names: `botmesh_` prefix

`toPrometheus(bot.metrics())` (`@botmesh/core`) now names every family
`botmesh_*` instead of `botwa_*`, for example `botmesh_messages_in_total`.
Dashboards and alerts that query the old names keep working if you pass the
old prefix:

```ts
toPrometheus(bot.metrics(), { prefix: 'botwa_' })
```

The OpenTelemetry bridge (`@botmesh/otel`) moved from `botwa.*` to `botmesh.*`
the same way (`otelMetricsPlugin({ prefix: 'botwa' })` keeps the old names),
and the control plane (`@botmesh/manager`) now serves
`botmesh_manager_bots_registered` and `botmesh_manager_bots_running`.

## Environment variables

| New name | Old name (still read) | Where |
|---|---|---|
| `BOTMESH_DEV=1` | `BOT_WA_DEV=1` (still set) | set by `botmesh dev` for your bot code |
| `BOTMESH_MANAGER_LOG_LEVEL` | `BOTWA_MANAGER_LOG_LEVEL` | default logger of `BotManager` |
| `BOTMESH_DOCS_DIR` | `BOTWA_DOCS_DIR` | docs tree of the MCP server |

The hot-reload query of `botmesh dev` is now `?botmesh_v=<n>` (it shows in
stack traces only).

## `@botmesh/redis-store`: `redis` is a peer dependency

`redis` (node-redis) moved from `dependencies` to `peerDependencies` with the
range `^4.7.0 || ^5.0.0 || ^6.0.0`. npm and pnpm install a missing peer
dependency on their own (node-redis 6), so `pnpm add @botmesh/redis-store`
still works; if you already depend on `redis`, the store uses your version.

- node-redis 5 and 6 are now supported, on a single node and on Redis Cluster,
  with RESP2 or RESP3 (the node-redis 6 default).
- `NativeRedisClient` and `NativeRedisClusterClient` are now small structural
  interfaces instead of `ReturnType<typeof createClient>`, so the client of any
  supported major type-checks. Code that used them to call commands should use
  the type from `redis` instead (`ReturnType<typeof createClient>`).

## `@botmesh/baileys`: ffmpeg is no longer bundled

The provider no longer depends on `fluent-ffmpeg` (deprecated upstream) or
`@ffmpeg-installer/ffmpeg` (unmaintained, an old ffmpeg). Voice notes are
transcoded by running an ffmpeg binary directly, found in this order:

1. `FFMPEG_PATH`, when it is set;
2. the optional peer dependency `ffmpeg-static`, when it is installed and its
   binary was downloaded (with pnpm, allow its build script);
3. `ffmpeg` on the `PATH` (`apt install ffmpeg`, `brew install ffmpeg`,
   `choco install ffmpeg`).

Without any of them, a voice note rejects with an `UnsupportedContentError`
that explains how to install ffmpeg (when `ffmpeg-static` is installed but its
binary was never downloaded, the message says to allow its build script and
reinstall it). Text, images and the rest are not
affected. The Docker image of a bot that sends voice notes needs ffmpeg
installed (or `ffmpeg-static`).

Baileys itself stays on `7.0.0-rc14`: no stable 7.x exists yet (see the
[package README](https://github.com/andresayac/botmesh/tree/main/packages/baileys-provider#requirements)
and its upstream upgrade policy).

## Meta providers: Graph API v26.0

`@botmesh/meta`, `@botmesh/messenger` and `@botmesh/instagram` now call Graph
API `v26.0` by default (it was `v21.0`, which Meta retires on 2027-01-21). The
send and webhook payloads the providers use did not change between those
versions. To stay on a version, pin it:

```ts
new CloudAPIProvider({ /* ... */ apiVersion: 'v21.0' })
```

WhatsApp's `played` status (a voice note was listened to) is now delivered as
`status: 'read'` with `platformData.played: true`; it used to be dropped.

## `@botmesh/ai`: SDKs and default models

| Change | Before | Now |
|---|---|---|
| Gemini SDK | `@google/generative-ai` (deprecated upstream) | `@google/genai` `^2`; the old SDK is still used, with a `DeprecationWarning`, when the new one is not installed |
| Anthropic default model | `claude-opus-4-8` | `claude-opus-5-5` |
| Gemini default model | `gemini-2.0-flash` (shut down by Google) | `gemini-3.8-flash` |
| `grok` preset model | `grok-2-latest` | `grok-4.7` |
| `glm` preset model | `glm-4-plus` | `glm-5.3` |

To move a Gemini bot: `pnpm remove @google/generative-ai && pnpm add @google/genai`.
Nothing else changes in `aiPlugin`; `baseUrl` becomes the SDK's
`httpOptions.baseUrl`. For Vertex AI, build the client yourself with
`fromGoogleGenAI` (see [Gemini](/guide/ai#gemini)).

Default models are not covered by semver: set `model` when the choice matters.
Claude Opus 5.5 always thinks (`thinking: 'off'` lowers nothing on it; use
`effort: 'low'`) and its effort defaults to `medium`.

## `@botmesh/hub`: `botmesh` manifest field

A plugin manifest declares its runtime range in `botmesh` (`"botmesh": "^2.0.0"`).
Manifests with the old `botwa` field are still accepted, and validation returns
them with `botmesh`.

## `eslint-plugin-botmesh`: type names

The exported types are `BotMeshConfigs` and `BotMeshPlugin`. The old
`BotWaConfigs` and `BotWaPlugin` are kept as deprecated aliases of the same
types, so existing imports keep compiling; rename them when convenient.

## Names that stay

Some identifiers from the project's former name live in stored data. Renaming
them would hide data that already exists, so they are permanent:

| Name | Where |
|---|---|
| key prefix `'botwa'` | default `prefix` of `RedisStore`, `RedisCoordinator`, `RedisDurability`, `RedisScheduleStore` and `RedisLeaseProvider` |
| `$botwaMedia` | media marker inside durable inbox records |
| `'botwa:durable'`, `botwa.inbound.*`, `botwa.outbox` | channel, event types and sidecar of `@botmesh/events/durability` |
| database `botwa` | default database of `MongoStore` and of the Postgres/MySQL connection strings |
| `BOTWA_TEST_*` | variables of the repository's own integration tests (never read by a published package) |

Pass your own `prefix`, `dbName` or connection string to use other names in a
new deployment.

## Next steps

- [Upgrade to stable: checklist and API changes](./stable-migration)
- [Upgrade to stable: behaviour changes](./migration-2)
