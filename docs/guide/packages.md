# Packages and versions

botmesh is a set of packages in one monorepo: the engine, `@botmesh/core`, plus
one package per channel, store, plugin and tool. This page is the reference for
which of them are published, under which npm tag, and what every package
requires. Other pages link here instead of repeating it.

## Release status

botmesh is in **beta**. The public packages are published from the
[Changesets](https://github.com/changesets/changesets) prerelease mode `beta`:

| Package | Beta versions | Stable line |
| --- | --- | --- |
| `@botmesh/core` | `2.0.0-beta.N` | `2.0.0` |
| Every other public package | `1.0.0-beta.N` | `1.0.0` |

The guides document the beta and the API it freezes for the stable line.
Coming from a 2.0 alpha, read the [upgrade guide](./stable-migration).

## npm dist-tags

- **`beta`** always points at the newest beta of each package. A publish moves
  it automatically.
- **`latest`** is what a plain install (`pnpm add @botmesh/core`) resolves to.
  The release tooling never moves it during the beta: the maintainer moves it
  **by hand** to the same versions after each publish, so a plain install gets
  the beta too.

Right after a publish, `latest` can still point at the previous beta for a
while. Check the tags with:

```bash
pnpm view @botmesh/core dist-tags
```

## Installing

Install the core plus the packages you need, with a plain install:

```bash
pnpm add @botmesh/core @botmesh/baileys
```

or with the `beta` tag, which always gets the newest beta (use it when
`latest` lags behind):

```bash
pnpm add @botmesh/core@beta @botmesh/baileys@beta
```

Install every `@botmesh/*` package from the **same tag**. The published
packages depend on each other with caret ranges (`^x.y.z`), so the package
manager keeps a single copy of `@botmesh/core`; mixing builds from different
tags can fail on missing exports or peer ranges (see
[Troubleshooting](./troubleshooting#pnpm-add-botmesh-core-installs-an-older-build)).
To start a new project, `npm create botmesh` stamps matching versions for you
(see [Quick start](./getting-started)).

## Requirements

- **Node.js 22 or newer.** Every package declares `"engines": { "node": ">=22" }`.
  The [quick start](./getting-started#requirements) recommends 22.12 or newer.
- **ESM only.** No package ships CommonJS: use `import` (never `require()`),
  set `"type": "module"` in your `package.json` (or use `.mjs` files) and, with
  TypeScript, `"module": "nodenext"`.
- Optional SDKs are **peer dependencies loaded lazily**: the LLM SDKs of
  `@botmesh/ai`, `better-sqlite3`, `pg`, `mysql2`, `mongodb` and `redis` for the
  stores, `imapflow` and `nodemailer` for email, `pdf-parse` for RAG,
  `@opentelemetry/api` for `@botmesh/otel`. Install the one you use.

## Entry points and semver

A package's main entry (`@botmesh/core`, `@botmesh/telegram`…) is its public
API, covered by semver. Some packages add subpath entries:

| Entry | What it holds |
| --- | --- |
| `@botmesh/core/spi` | Building blocks for store, durability, scheduler and transport authors. Covered by semver. |
| `@botmesh/core/testing` | `createTestBot`, `MockProvider` and the contract helpers ([Testing](./testing)). Covered by semver. |
| `@botmesh/core/dev` | The terminal simulator as a library ([Terminal simulator](./dev-simulator)). |
| `@botmesh/server/express`, `/fastify`, `/hono` | Framework adapters of the [webhook server](./server). |
| `@botmesh/events/durability` | The event-journal durability backend ([Durable processing](./durability)). |
| `@botmesh/ai/testing` | `MockAIProvider` and `validateArgs` ([AI plugin](./ai)). Covered by semver. |
| `<package>/internal` | Engine internals and building blocks, with **no semver guarantee**: they can change in any release. A published package never imports another package's `/internal`. |

## Public packages (36)

All of them are on npm under `beta` and `latest`. The directory is the folder
under [`packages/`](https://github.com/andresayac/botmesh/tree/main/packages).

**Engine**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/core` | `core` | [Core concepts](./concepts) |

**Channels (12)**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/baileys` | `baileys-provider` | [Baileys (WhatsApp Web)](./baileys) |
| `@botmesh/meta` | `meta-provider` | [WhatsApp Cloud API](./whatsapp-cloud-api) |
| `@botmesh/evolution` | `evolution-provider` | [Evolution API](./evolution) |
| `@botmesh/wppconnect` | `wppconnect-provider` | [WPPConnect](./wppconnect) |
| `@botmesh/twilio` | `twilio-provider` | [Twilio](./twilio) |
| `@botmesh/gupshup` | `gupshup-provider` | [Gupshup](./gupshup) |
| `@botmesh/gohighlevel` | `gohighlevel-provider` | [HighLevel](./gohighlevel) |
| `@botmesh/messenger` | `messenger-provider` | [Messenger](./messenger) |
| `@botmesh/instagram` | `instagram-provider` | [Instagram](./instagram) |
| `@botmesh/telegram` | `telegram-provider` | [Telegram](./telegram) |
| `@botmesh/discord` | `discord-provider` | [Discord](./discord) |
| `@botmesh/email` | `email-provider` | [Email](./email) |

**Shared infrastructure**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/http` | `http` | [Security](./security) (SSRF-safe HTTP client) |
| `@botmesh/graph-core` | `graph-core` | Shared Meta Graph helpers of `meta`, `messenger` and `instagram` |
| `@botmesh/wa-gateway-kit` | `wa-gateway-kit` | Shared identity, REST and media of `evolution` and `wppconnect` |
| `@botmesh/server` | `server` | [Webhook server](./server) |

**Stores (5)**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/sqlite-store` | `sqlite-store` | [Persistent store](./store) |
| `@botmesh/redis-store` | `redis-store` | [Persistent store](./store), [Redis Cluster](./redis-cluster) |
| `@botmesh/postgres-store` | `postgres-store` | [Persistent store](./store) |
| `@botmesh/mysql-store` | `mysql-store` | [Persistent store](./store) |
| `@botmesh/mongo-store` | `mongo-store` | [Persistent store](./store) |

**Operations and observability**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/events` | `events` | [Operations](./operations) |
| `@botmesh/otel` | `otel` | [Tracing (OpenTelemetry)](./tracing) |

**Plugins (8)**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/ai` | `ai` | [AI plugin](./ai) |
| `@botmesh/rag` | `rag` | [AI memory & RAG](./ai-memory-rag) |
| `@botmesh/voice` | `voice` | [Voice (STT/TTS)](./voice) |
| `@botmesh/nlu` | `nlu` | [Integrations](./integrations) |
| `@botmesh/dialogflow` | `dialogflow` | [Integrations](./integrations) |
| `@botmesh/chatwoot` | `chatwoot` | [Integrations](./integrations) |
| `@botmesh/tickets` | `tickets` | [Integrations](./integrations) |
| `@botmesh/moderation` | `moderation` | [Integrations](./integrations) |

**Tooling**

| Package | Directory | Guide |
| --- | --- | --- |
| `@botmesh/flow-schema` | `flow-schema` | [JSON flow schema](./flow-schema) |
| `create-botmesh` | `create-botmesh` | [Quick start](./getting-started) |
| `eslint-plugin-botmesh` | `eslint-plugin` | [ESLint plugin](./eslint) |
| `@botmesh/mcp` | `mcp` | [MCP server](./mcp) |

Ten of them were first published during the alpha (`core`, `baileys`, `meta`,
`telegram`, `sqlite-store`, `redis-store`, `ai`, `http`, `graph-core` and
`create-botmesh`); the other 26 were published for the first time with the beta.

## Private packages (9)

These packages are implemented and tested, but they have `"private": true` in
their `package.json`: they are **not on npm**, they do not follow semver and
their API may change. Pages that document them carry an "Experimental" notice
and sit at the end of their section. Use them from a clone of the monorepo,
with `"workspace:*"` dependencies. A published package never depends on them.

| Package | Directory | What it is | Guide |
| --- | --- | --- | --- |
| `@botmesh/tiktok` | `tiktok-provider` | TikTok channel (comments and DMs) | [TikTok](./tiktok) |
| `@botmesh/manager` | `manager` | Many bots per process, REST control plane | [Control plane](./control-plane) |
| `@botmesh/sandbox` | `sandbox` | Local platform simulators and web chat | [Platform sandbox](./sandbox) |
| `@botmesh/inbox` | `inbox` | Shared inbox: assignment, notes, unread | [Operations](./operations#operational-packages) |
| `@botmesh/crm` | `crm` | Contacts, tags, consent and segments | [Operations](./operations#operational-packages) |
| `@botmesh/hub` | `hub` | Plugin manifests and permissions | [Operations](./operations#operational-packages) |
| `@botmesh/campaigns` | `campaigns` | Campaign sends with consent and dedupe | [Operations](./operations#operational-packages) |
| `@botmesh/deployments` | `deployments` | Publish gate and audit log for flows | [Golden transcripts](./golden-transcripts#publish-gate-botmesh-deployments) |
| `@botmesh/tenant-kv` | `tenant-kv` | Per-tenant JSON documents over any `DurableKv` | [Operations](./operations#operational-packages) |

The repository also holds a runnable example, `examples/bakery-ai`
(`@botmesh/example-bakery-ai`, private).

## Next steps

- [Quick start](./getting-started): scaffold a project or install by hand.
- [Channels](./channels): choose a channel and compare what each one supports.
- [Upgrade guide](./stable-migration): moving from a 2.0 alpha.
