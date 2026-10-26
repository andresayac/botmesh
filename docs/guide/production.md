# Going to production

A checklist for taking a bot from "works on my machine" to a deployment you can
leave running. Each item links to the page with the details. Work through
**Every bot** first; the later sections only apply when you need them.

## Every bot

### Runtime

- **Node.js 22 or later**, and your app is ESM (`"type": "module"` in
  `package.json`, or `.mjs` files). The packages ship no CommonJS build.
- **A process manager** restarts the bot when it exits: PM2, systemd,
  Docker `restart: unless-stopped` or your orchestrator. See [Deployment](./deploy).
- **Graceful shutdown**: on `SIGTERM`/`SIGINT` call
  `await bot.stop({ drain: true, timeout: '15s' })` so replies in flight are
  sent and recorded before the process exits
  ([Graceful shutdown](./deploy#graceful-shutdown)).
- **Pin your versions** (commit the lockfile). While the packages are in
  prerelease, read the [migration pages](./stable-migration) before each upgrade.

### State

- **A persistent store.** The default `MemoryStore` keeps everything in RAM.
  Use `SQLiteStore` for one process or `RedisStore` for several
  ([Persistent store](./store#choosing-a-store)).
- Pass the store **instance**: `store: new SQLiteStore({ file })`. A string
  such as `store: 'sqlite'` is accepted for compatibility but still creates a
  `MemoryStore`.
- **Multi-step flows are `.persistent()`**, so a user in the middle of a
  flow resumes it after a restart ([Flows](./flows)).
- **On Node.js 24.19 or later, use `better-sqlite3` 13** with `SQLiteStore`
  ([why](./store#sqlitestore)).
- **Volumes and backups**: the WhatsApp session folder (`sessions/`) and the
  data folder (`data/`) are mounted on persistent disk and backed up together
  ([Backups](./deploy#backups)).

### Secrets

- Tokens, API keys and webhook secrets come from the environment (or your
  secret manager), never from the source tree. The framework reads no
  environment variable by itself: you map them to the provider options
  ([Environment variables](./deploy#environment-variables)).
- `sessions/`, `.env`, `*.db` and `*.qr.png` are in `.gitignore` and never
  copied into a Docker image.

### Webhooks (Cloud API, Telegram webhook, Twilio…)

- Served over **HTTPS**, with the channel's signature check configured
  (`appSecret`, `webhookSecret`…). Never set `allowUnsignedWebhooks: true` in
  production ([Security](./security#production-checklist)).
- The signature is checked on the **raw body**: do not put a JSON body
  parser in front of the webhook route ([Webhook server](./server)).

### Observability

- **Logs**: pass your own pino `logger` (or keep the built-in one, which
  logs at `warn`). Chat and sender ids are hashed in log lines by default
  (`logIds: 'hash'`); keep it that way outside local debugging.
- **Errors**: listen to `bot.on('error', …)` and send them to your error
  tracker.
- **Health and metrics**: expose a liveness/readiness endpoint and
  `bot.metrics()` in Prometheus format ([Health checks](./deploy#health-checks),
  [Operations](./operations#runtime-metrics)).

### Channel limits

- **WhatsApp on Baileys**: keep the provider's rate limiter on and avoid
  unsolicited bulk sends ([Rate limiting](./rate-limiting)).
- **Cloud API**: free-form replies only within the 24-hour window; use
  templates outside it ([WhatsApp 24h window](./session-window)).
- **Message log growth**: the persistent stores keep every message unless
  you set `maxMessagesPerChat` ([Persistent store](./store#sqlitestore)).

## When you need more

| You need… | Turn on | Guide |
| --- | --- | --- |
| No lost or duplicated replies when the process crashes mid-message | `BotConfig.durability` with a persistent backend | [Durable message processing](./durability) |
| Reminders and reports that survive restarts and run once with several replicas | Durable tasks (`{ id }`) + `BotConfig.scheduler` | [Scheduler](./scheduler#durable-tasks-survive-restarts-one-replica-per-run) |
| Several processes of one bot (failover, rolling deploys, webhook throughput) | `BotConfig.coordination` + `RedisStore` | [Running N replicas](./replicas) |
| Redis Cluster instead of a single Redis | The `'cluster'` key layout | [Redis Cluster](./redis-cluster) |
| Where the time goes in each message | `BotConfig.telemetry` | [Tracing](./tracing) |

All of these are opt-in: without the option, the bot runs exactly as before.

## Which packages are published

The npm packages are `@botmesh/core`, `@botmesh/baileys`, `@botmesh/meta`,
`@botmesh/telegram`, `@botmesh/messenger`, `@botmesh/instagram`,
`@botmesh/evolution`, `@botmesh/wppconnect`, `@botmesh/sqlite-store`,
`@botmesh/redis-store`, `@botmesh/postgres-store`, `@botmesh/mysql-store`,
`@botmesh/mongo-store`, `@botmesh/ai`, `@botmesh/http`, `@botmesh/graph-core`,
`@botmesh/wa-gateway-kit`, `@botmesh/server`, `@botmesh/events`, `@botmesh/otel`
and `create-botmesh` (all but `@botmesh/telegram`, `@botmesh/sqlite-store`,
`@botmesh/redis-store`, `@botmesh/ai`, `@botmesh/http` and `@botmesh/graph-core`
ship for the first time with the beta).
Some pages also describe packages that live only in the
[repository](https://github.com/andresayac/botmesh/tree/main/packages) for now
(the TikTok channel, the sandbox…). Each of those pages says so. Plan a
production deployment on the published ones.

## Before each release of your bot

- Tests pass with `createTestBot` / `MockProvider` ([Testing](./testing)).
- The store files or databases are backed up **before** upgrading
  `@botmesh/sqlite-store`: a newer schema version cannot be opened by an older
  release ([Schema versions](./store#schema-versions-and-upgrades)).
- With replicas, every replica runs a version that understands the options
  you turn on (for example `coordination.handover.flows: 'forward'`).
