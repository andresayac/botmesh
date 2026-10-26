# Deployment

How to run a bot in production and keep it connected. For the full list of
things to check before going live, see [Going to production](./production).

::: tip ESM-only, Node >= 22
`@botmesh/core` and the transport packages are pure ESM, with no CommonJS
build. Your production `package.json` needs `"type": "module"` (or `.mjs`
entry files), and the runtime must be **Node.js 22 or later**.
:::

The examples below assume the layout `create-botmesh` generates: the entry
file is `src/bot.js`, started with `npm start`
(`node --env-file-if-exists=.env src/bot.js`). Adjust the paths if yours differ.
If you write TypeScript, compile it first (`tsc`) and start the compiled file.

## Option 1: a VPS with PM2

### 1. Prepare the server

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/your-user/my-bot.git
cd my-bot
npm ci --omit=dev
```

### 2. First connection (WhatsApp on Baileys)

```bash
npm start
# Scan the QR code, then press Ctrl+C
```

The session is saved under `./sessions/<session>`. As long as that folder
survives, the bot reconnects without a new scan. Telegram, Cloud API and the
other token-based channels skip this step.

### 3. Keep it running with PM2

```bash
npm install -g pm2
pm2 start src/bot.js --name my-bot --kill-timeout 20000 --node-args="--env-file-if-exists=.env"
pm2 save
pm2 startup  # prints the command that starts PM2 on boot
```

```bash
pm2 status          # state of every process
pm2 logs my-bot     # follow the logs
pm2 restart my-bot  # restart: PM2 sends SIGINT, then SIGKILL after --kill-timeout
pm2 stop my-bot
```

`pm2 restart` and `pm2 stop` only shut the bot down cleanly if it handles the
signal: add the handler from [Graceful shutdown](#graceful-shutdown) (neither
the core nor the generated `bot.js` installs one). PM2 kills the process
`kill_timeout` ms after `SIGINT` (1600 ms by default), so keep `--kill-timeout`
longer than the drain timeout.

## Option 2: Docker

### Dockerfile

```dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# The session and the database live on volumes, never in the image.
RUN mkdir -p /app/sessions /app/data
CMD ["node", "src/bot.js"]
```

With pnpm, replace the install lines with
`RUN corepack enable && pnpm install --prod --frozen-lockfile` and copy
`pnpm-lock.yaml` instead of `package-lock.json`. pnpm 10 and later skip the
build script of `better-sqlite3` until you approve it (`onlyBuiltDependencies`
in `pnpm-workspace.yaml`, see [SQLiteStore](./store#sqlitestore)).

Add a `.dockerignore` with `node_modules`, `sessions`, `data`, `.env` and
`*.qr.png`, so credentials never end up in an image layer.

### docker-compose.yml

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    stop_grace_period: 30s           # time for bot.stop({ drain: true })
    volumes:
      - ./sessions:/app/sessions     # WhatsApp session (Baileys)
      - ./data:/app/data             # SQLite database
    ports:
      - '127.0.0.1:9464:9464'        # health and metrics, see below
```

```bash
docker compose up -d
docker compose logs -f bot  # the first time, scan the QR printed here
```

Docker sends `SIGTERM` on `docker compose stop` and waits `stop_grace_period`
before it kills the container: keep it longer than the drain timeout.

## Environment variables

The framework reads **no** environment variable by itself: every credential
and setting is a constructor option. Map your variables explicitly, for example:

```ts
import { Bot } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'
import { SQLiteStore } from '@botmesh/sqlite-store'

/** A required variable: fails at startup with one clear line when it is missing. */
function env(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

const bot = new Bot({
  provider: new CloudAPIProvider({
    accessToken: env('META_TOKEN'),
    phoneNumberId: env('META_PHONE_ID'),
    verifyToken: env('META_VERIFY_TOKEN'),
    appSecret: env('META_APP_SECRET'),
  }),
  store: new SQLiteStore({ file: process.env.SQLITE_FILE ?? './data/bot.db' }),
})
```

Load a local `.env` with `node --env-file-if-exists=.env`, and in production
take the values from your orchestrator or secret manager. Checking the required
ones at startup (like `env()` above) makes a missing secret fail with one clear
line instead of a provider error later.

## Persistence

### Sessions

The Baileys provider saves the WhatsApp credentials under
`sessionsDir/<session>` (default `./sessions/<session>`). **Do not delete that
folder**, or you will have to scan the QR again:

```ts
const provider = new BaileysProvider({ session: 'my-bot', sessionsDir: './sessions' })
```

The folder holds the account's keys: treat it like a password (restricted
permissions, encrypted backups, never in git or in an image).

### Store

The default `MemoryStore` lives in RAM. In production use **`SQLiteStore`** for
one process (or `RedisStore` for several replicas), so messages, chats,
contacts, flow checkpoints and AI history survive restarts:

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'my-bot' }),
  store: new SQLiteStore({ file: './data/bot.db' }),
})
```

The folder of `file` must exist (SQLite creates the file, not its folders).
With a persistent store, `flow(...).persistent()` checkpoints survive restarts.
See [Persistent store](./store).

### Backups

Back up the session and the data together: they are what lets a redeployed bot
resume without a new QR scan or lost conversations.

```bash
pm2 stop my-bot            # or: docker compose stop bot
tar -czf backup-$(date +%F).tar.gz sessions/ data/
pm2 start my-bot
```

Copy SQLite files while the bot is stopped, or use
`sqlite3 data/bot.db ".backup backup.db"` while it runs: with WAL on, a plain
copy of a live database can miss the latest writes. Take a backup before you
upgrade `@botmesh/sqlite-store`, because a file migrated to a newer schema
cannot be opened by an older release.

## Graceful shutdown

`bot.stop()` disconnects the provider and ends active conversations. With
`{ drain: true }` it first **waits for sends in flight**, so a deploy does not
cut a reply in half:

```ts
async function shutdown(signal: string) {
  bot.logger.info({ signal }, 'shutting down')
  await bot.stop({ drain: true, timeout: '15s' }) // a duration or ms
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
```

| Option | Type | Default | Description |
|---|---|---|---|
| `drain` | `boolean` | `false` | Wait for sends in flight before stopping |
| `timeout` | `string \| number` | `10000` | Longest wait for the drain (a duration such as `'15s'`, or ms) |

Replies still being sent when `stop()` begins, and those the provider already
accepted, are recorded in the message log (after-send hooks and the store
write, up to 5 s) before the store is closed, with or without `drain`.

After the drain nothing keeps running: messages still queued for a chat are
dropped, no new conversation starts until `start()`, paced replies still
waiting resolve with `{ skipped: true }` and running `ctx.stream()`s are
cancelled without touching the transport again (they resolve with
`cancelled: true`). No timer of the bot keeps the process alive afterwards.

With [durability](./durability), a message dropped this way is still in the
journal and is processed on the next start.

## Health checks

A small HTTP endpoint tells Docker, Kubernetes or your load balancer whether
the bot is alive and connected. `bot.getConnectionState()` is `'connecting'`,
`'authenticating'`, `'ready'` or `'closed'`:

```ts
import { createServer } from 'node:http'
import { toPrometheus, PROMETHEUS_CONTENT_TYPE } from '@botmesh/core'

let stopping = false
bot.on('stopping', () => { stopping = true })

createServer((req, res) => {
  if (req.url === '/healthz') return void res.writeHead(200).end('ok')        // liveness
  if (req.url === '/readyz') {                                                 // readiness
    const ready = !stopping && bot.getConnectionState() === 'ready'
    return void res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : bot.getConnectionState())
  }
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE)
    return void res.end(toPrometheus(bot.metrics()))
  }
  res.writeHead(404).end()
}).listen(9464)
```

- Use `/healthz` for **liveness** (restart the container when it fails) and
  `/readyz` for **readiness** (send traffic only while it passes).
- With [replicas](./replicas) and an exclusive transport (Baileys), the standby
  replicas are not connected on purpose, so their `/readyz` answers `503`. Do
  not restart them for it.
- Bind the port to a private interface or protect it: `bot.metrics()` holds no
  personal data, but it describes your traffic.
- `@botmesh/server` (in the repository, not on npm yet) serves `/healthz` and
  `/readyz` next to the webhook routes: see [Webhook server](./server).

```yaml
# docker-compose.yml, inside the bot service
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:9464/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## Logging

Without `logger`, the bot logs through a built-in pino logger at `warn`, so
warnings from plugins and handlers (for example a failed AI reply) are visible,
and `debug: true` lowers it to `debug`. In production, pass your own logger to
choose the level and the destination:

```ts
import pino from 'pino'

const bot = new Bot({
  provider,
  logger: pino({ level: process.env.LOG_LEVEL ?? 'info' }),
  // logIds: 'hash' (default) | 'raw' | 'omit': how chat and sender ids appear in log lines
})
```

Chat and sender ids (phone numbers, emails) are hashed in the bot's log lines
by default. Use `logIds: 'raw'` for local debugging only.

## Next steps

- [Going to production](./production): the full checklist
- [Running N replicas](./replicas): several processes of one bot (failover, webhook throughput)
- [Operations](./operations): metrics and events
- [FAQ](./faq): common problems
