# botmesh

[![npm](https://img.shields.io/npm/v/@botmesh/core?label=%40botmesh%2Fcore)](https://www.npmjs.com/package/@botmesh/core)
[![Docs](https://img.shields.io/badge/docs-andresayac.github.io%2Fbotmesh-blue)](https://andresayac.github.io/botmesh/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE.md)

A TypeScript framework for messaging bots. Write handlers and conversation flows once and run them on **WhatsApp** (the unofficial [Baileys 7](https://github.com/WhiskeySockets/Baileys) protocol, the **official Meta Cloud API**, Twilio or Gupshup), **Telegram**, **Discord**, **email**, SMS (Twilio) and HighLevel CRM conversations, with experimental providers for Messenger, Instagram, TikTok and more WhatsApp gateways (Evolution API, WPPConnect). Try your bot in the terminal before connecting a phone, test it without a network, and add AI, persistence or multiple replicas when you need them.

**Documentation: <https://andresayac.github.io/botmesh/>** ([English](https://andresayac.github.io/botmesh/guide/getting-started) · [Español](https://andresayac.github.io/botmesh/es/guide/inicio) · [API reference](https://andresayac.github.io/botmesh/api/))

## A bot in 30 seconds

```js
import { Bot, flow } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }) })

bot.when('hi', (ctx) => ctx.reply('👋 Hello!'))

bot.use(
  flow('signup')
    .ask('What is your name?', 'name')
    .say((_ctx, c) => `Nice to meet you, ${c.state.name}!`),
)

await bot.start() // scan the QR with WhatsApp → Linked devices
```

Swap `BaileysProvider` for `TelegramProvider` (`@botmesh/telegram`) or `CloudAPIProvider` (`@botmesh/meta`) and the rest stays the same.

## Quick start

```bash
npm create botmesh my-bot      # templates: baileys, telegram, meta, ai, store, support…
cd my-bot && npm install
npm run dev                    # chat with the bot in the terminal: no phone, no credentials
npm start                      # connect the real channel
```

Or add it to an existing project (Node >= 22, ESM-only):

```bash
npm install @botmesh/core @botmesh/baileys     # WhatsApp (Baileys)
npm install @botmesh/core @botmesh/telegram    # Telegram
npm install @botmesh/core @botmesh/meta        # WhatsApp Cloud API
npm install @botmesh/ai @anthropic-ai/sdk      # + AI (optional; the SDK of the provider you use)
```

> **Prerelease.** botmesh is not stable yet, and these docs describe the upcoming release. During the beta, add the tag to these commands (`npm create botmesh@beta`, `npm install @botmesh/core@beta …`): without it npm installs `latest`, which can still point to an older alpha. Until the beta is published, npm only has older alphas that differ from the docs in places (built-in texts default to Spanish, `pairingCode` instead of `pairingPhoneNumber`, and a scaffolded project needs a `.env` before `npm start`). Once `@botmesh/core` 2.0.0 ships, the commands work as written.

The [getting started guide](https://andresayac.github.io/botmesh/guide/getting-started) walks through the simulator, linking WhatsApp and connecting Telegram step by step.

> **AI on WhatsApp:** since 2026-01-15 the WhatsApp Business Platform terms forbid general-purpose AI assistants (open ChatGPT-style chatbots). AI in the service of the business (support, sales, bookings) is allowed. Details in the [AI plugin guide](https://andresayac.github.io/botmesh/guide/ai#whatsapp-ai-policy-since-2026-01-15).

## Packages

This is a pnpm monorepo with **45 packages**: 15 **Public**, 22 **Experimental** and 8 **Product** and internal ones. They are not all equally mature, and the **Status** column says so plainly:

- **Public**: published on npm and covered by semver from the stable release on (prerelease builds until then).
- **Experimental**: real, tested implementation, but the package is `private`. Not published yet and its API may change.
- **Product / internal**: real, persistent implementation (`private`) over any core `DurableKv`. Per-tenant isolation and compare-and-set in the backend; the API may still change.

| Package | Status | Description |
| --- | --- | --- |
| **Core** | | |
| [`@botmesh/core`](packages/core) | Public | Transport-agnostic engine: `Bot`, `IProvider v2`, dispatcher, flows/conversations, hooks, plugins, store, testing kit. |
| **Transports (channels)** | | |
| [`@botmesh/baileys`](packages/baileys-provider) | Public | WhatsApp through Baileys 7 (unofficial, QR or pairing code). |
| [`@botmesh/meta`](packages/meta-provider) | Public | **Official** WhatsApp Cloud API (webhook, no ban risk, native buttons/lists/templates). |
| [`@botmesh/telegram`](packages/telegram-provider) | Public | Telegram Bot API (long-poll/webhook, inline keyboards, native polls). |
| [`@botmesh/messenger`](packages/messenger-provider) | Experimental | Facebook Messenger (Meta Graph, quick replies/templates). |
| [`@botmesh/instagram`](packages/instagram-provider) | Experimental | Instagram DM (Meta Graph, quick replies). |
| [`@botmesh/discord`](packages/discord-provider) | Public | Discord (gateway websocket + REST, slash/components). |
| [`@botmesh/evolution`](packages/evolution-provider) | Experimental | WhatsApp through [Evolution API](https://github.com/EvolutionAPI/evolution-api) (self-hosted REST gateway, signed webhook). |
| [`@botmesh/wppconnect`](packages/wppconnect-provider) | Experimental | WhatsApp through WPPConnect Server (REST + token webhook). |
| [`@botmesh/twilio`](packages/twilio-provider) | Public | WhatsApp and SMS through Twilio Programmable Messaging (`X-Twilio-Signature` webhooks). |
| [`@botmesh/gupshup`](packages/gupshup-provider) | Public | WhatsApp through Gupshup (API v1 + v2 callbacks). |
| [`@botmesh/gohighlevel`](packages/gohighlevel-provider) | Public | GoHighLevel / LeadConnector (Conversations API + signed `InboundMessage` webhooks). |
| [`@botmesh/email`](packages/email-provider) | Public | Email: inbound IMAP IDLE + outbound SMTP, threading, loop and bounce protection. |
| [`@botmesh/tiktok`](packages/tiktok-provider) | Experimental | TikTok API for Business: DMs (Business Messaging) and replies to comments on your own videos. |
| **Stores (persistence)** | | |
| [`@botmesh/sqlite-store`](packages/sqlite-store) | Public | SQLite (`better-sqlite3`, WAL). |
| [`@botmesh/redis-store`](packages/redis-store) | Public | Distributed Redis (+ multi-replica lock). |
| [`@botmesh/mongo-store`](packages/mongo-store) | Experimental | MongoDB. |
| [`@botmesh/postgres-store`](packages/postgres-store) | Experimental | PostgreSQL (`pg`). |
| [`@botmesh/mysql-store`](packages/mysql-store) | Experimental | MySQL/MariaDB (`mysql2`). |
| **Plugins** | | |
| [`@botmesh/ai`](packages/ai) | Public | AI: Anthropic/OpenAI/Ollama/Gemini + 9 OpenAI-compatible presets (DeepSeek/Qwen/GLM/Kimi/Groq/…), auto-reply, tool calling with confirmation, per-user long-term memory and RAG. See the [WhatsApp AI policy](docs/guide/ai.md#whatsapp-ai-policy-since-2026-01-15). |
| [`@botmesh/nlu`](packages/nlu) | Experimental | Local intents/NLU (define/match + `whenIntent`), no external services. |
| [`@botmesh/manager`](packages/manager) | Experimental | Multi-bot orchestrator (registry, lifecycle) + dependency-free HTTP API (control plane `/v1` with API keys). |
| [`@botmesh/otel`](packages/otel) | Experimental | OpenTelemetry: bot traces (inbound, dispatch, conversations, sends, AI) and `bot.metrics()` as OTel metrics. `@opentelemetry/api` as an optional peer. |
| [`@botmesh/events`](packages/events) | Experimental | Versioned envelopes, idempotent journal, retries and DLQ for asynchronous processes. |
| [`@botmesh/rag`](packages/rag) | Experimental | RAG for `@botmesh/ai`: loaders, chunking, pluggable embeddings (OpenAI-compatible, Ollama, local hashing) and an in-memory vector index with optional JSON persistence. |
| [`@botmesh/voice`](packages/voice) | Experimental | Voice: voice-note transcription (OpenAI-compatible, Deepgram) and spoken replies (OpenAI, ElevenLabs). |
| [`@botmesh/chatwoot`](packages/chatwoot) | Experimental | Chatwoot bridge: two-way sync and human handoff driven by Chatwoot agents. |
| [`@botmesh/tickets`](packages/tickets) | Experimental | Support tickets and queues (`ctx.tools.tickets`): queue position, business hours and store persistence. |
| [`@botmesh/moderation`](packages/moderation) | Experimental | Group moderation: anti-spam, word/regex and invite-link filters, warn/mute/kick/delete actions. |
| [`@botmesh/dialogflow`](packages/dialogflow) | Experimental | Dialogflow ES/CX: `detectIntent` over REST (service-account JWT, no Google SDK) and intent routing to flows. |
| **Shared infrastructure** (dependencies of the public packages) | | |
| [`@botmesh/http`](packages/http) | Public | Safe HTTP client: anti-SSRF, redirect validation, timeouts and download limits. |
| [`@botmesh/graph-core`](packages/graph-core) | Public | Shared Meta Graph helpers (webhook verification, error mapping, ingest guard) used by meta/messenger/instagram. |
| [`@botmesh/wa-gateway-kit`](packages/wa-gateway-kit) | Internal | Code shared by the WhatsApp REST gateways (`evolution`, `wppconnect`): REST client over `secureFetch`, outbound media resolution and LID/PN identity reconciliation. Private; not installed directly. |
| [`@botmesh/server`](packages/server) | Experimental | Webhook ingress for the providers: raw body, size limits, timeouts, concurrency and health endpoints for `node:http`, Express, Fastify and Hono (no dependencies). |
| **Product / operations** (private, persistent) | | |
| [`@botmesh/inbox`](packages/inbox) | Product | Persistent omni-channel inbox: CAS assignment, handoff, notes, unread, SLA and ledger projection (`attachInbox`). |
| [`@botmesh/crm`](packages/crm) | Product | Contacts, tags, attributes, consent (lossless CAS) and per-tenant segments. |
| [`@botmesh/hub`](packages/hub) | Product | Per-tenant plugin registry: validated manifests and permission-gated enabling. It does not run or sandbox code. |
| [`@botmesh/campaigns`](packages/campaigns) | Product | Consent-aware campaigns: durable per-recipient reservations (TTL), atomic settlement and `sendCampaign()` over `bot.broadcast()`. |
| [`@botmesh/deployments`](packages/deployments) | Product | Immutable versions, active version, gate reservations, rollback and audited gate runs (including the golden-transcript gate). |
| [`@botmesh/tenant-kv`](packages/tenant-kv) | Internal | Per-tenant JSON documents with compare-and-set over any `DurableKv`: the base of the product packages. |
| [`@botmesh/flow-schema`](packages/flow-schema) | Internal | Versioned JSON schema for code-free flows, safe expressions, compilation to `CompiledFlow`, reverse export, migrations and deployment helpers. |
| **Tooling** | | |
| [`create-botmesh`](packages/create-botmesh) | Public | CLI scaffolder (`npm create botmesh`), 10 templates: `baileys`, `meta`, `telegram`, `ai` and the use-case ones `games`, `support`, `store`, `restaurant`, `clinic`, `ai-full`. Every project ships an `AGENTS.md` for coding agents. |
| [`eslint-plugin-botmesh`](packages/eslint-plugin) | Experimental | ESLint rules for bots: v1 API leftovers, blocking `runtime.enter`, async `install`, empty triggers, `ask` without timeout and per-user global state. |
| [`@botmesh/sandbox`](packages/sandbox) | Experimental | Local simulators of WhatsApp Cloud API, Messenger, Instagram, Twilio, Gupshup, HighLevel, TikTok, Discord and Telegram (signed webhooks, realistic errors, request-shape checks) with a web chat UI: `pnpm sandbox`. Docker suites for Evolution API, WPPConnect, Chatwoot and Mailpit. |
| [`@botmesh/mcp`](packages/mcp) | Experimental | Stdio MCP server (no dependencies) for agents: validates, compiles, renders, lints, migrates and diffs JSON flow documents without starting a bot; with `--docs` it searches these guides. |

## Development (in this repo)

```bash
pnpm install            # install the whole workspace
pnpm build              # pnpm -r build  → compiles every package
pnpm test               # pnpm -r test   → full suite
pnpm run docs           # TypeDoc + VitePress → documentation site
```

Per package: `pnpm --filter @botmesh/ai test`, `pnpm --filter @botmesh/core build`, and so on.

## Examples

| Example | What it shows |
| --- | --- |
| [`examples/bakery-ai`](examples/bakery-ai) | AI ordering assistant for a bakery (in English) on WhatsApp, through Baileys (QR) or Twilio (webhook with `@botmesh/server`). Tools with confirmation, totals computed in code, `dedupe`, an access list, typed configuration and tests with no network. |

They build and test with the rest of the workspace (`pnpm build`, `pnpm test`). Each example ships its own README with the commands to run it.

## Documentation

- Documentation site: **<https://andresayac.github.io/botmesh/>** (English guide, Spanish guide under [`/es/`](https://andresayac.github.io/botmesh/es/) and the [API reference](https://andresayac.github.io/botmesh/api/)). Sources in [`docs/`](docs) (English in `docs/guide/`, Spanish in `docs/es/guide/`); preview locally with `pnpm docs:dev`.
- Upgrading from an alpha: [Migrating to stable](https://andresayac.github.io/botmesh/guide/stable-migration). From v1 (`BaileysClass`): [`docs/MIGRATION-v1-to-v2.md`](docs/MIGRATION-v1-to-v2.md).
- Product and engineering roadmap: [`ROADMAP.md`](ROADMAP.md).
- Detailed catalogue of proposals: [`FEATURES.md`](FEATURES.md).
- Vulnerability reporting policy: [`SECURITY.md`](SECURITY.md).
- Design and decisions: [`docs/superpowers/specs/`](docs/superpowers/specs) and [`docs/superpowers/plans/`](docs/superpowers/plans).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Relevant changes go in [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT © Andres Aya
