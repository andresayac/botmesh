# Production-ready bot

Take a support bot to production as one small project: SQLite persistence,
durable message processing, health and metrics endpoints, JSON logs without
personal data, graceful shutdown and a Docker image.

**Level:** Advanced · **Tags:** Production, Docker, SQLite, Durability, WhatsApp

**Features shown:**
[Persistent store](/guide/store) (`SQLiteStore`, `maxMessagesPerChat`) ·
[Durable message processing](/guide/durability) (`store.durability()`) ·
[Persistent flows](/guide/flows) (`.persistent()`, `.timeout`) ·
[Graceful shutdown](/guide/deploy#graceful-shutdown) (`bot.stop({ drain })`) ·
[Health checks and metrics](/guide/deploy#health-checks) (`toPrometheus`, `bot.metrics()`) ·
[Logging](/guide/deploy#logging) (pino, `logIds`) ·
[Operations events](/guide/operations) ·
[Going to production](/guide/production)

## Prerequisites

Node.js 22.12 or newer, as in [Getting started](/guide/getting-started#requirements). Docker is optional.

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/sqlite-store better-sqlite3 pino
```

## Project layout

```text
support-bot/
├── src/bot.js            the bot, the health server and the shutdown
├── package.json
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── sessions/             WhatsApp login (volume, never in git or the image)
└── data/bot.db           SQLite: messages, flows, journals (volume)
```

## The complete bot

```js
// src/bot.js
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'
import { Bot, PROMETHEUS_CONTENT_TYPE, defineBot, flow, isMainModule, slashCommandsPlugin, toPrometheus } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const DB_FILE = process.env.DB_FILE ?? './data/bot.db'

const createBot = defineBot((provider) => {
  // 1. One SQLite file keeps messages, chats, flow checkpoints and the durable journals
  mkdirSync(dirname(DB_FILE), { recursive: true })
  const store = new SQLiteStore({ file: DB_FILE, maxMessagesPerChat: 1000 })

  const bot = new Bot({
    provider,
    store,
    // 2. Durability: a message cut short by a crash is replayed on restart, without double replies
    durability: { backend: store.durability(), instanceId: process.env.INSTANCE_ID ?? 'bot-1' },
    // 3. JSON logs; chat and sender ids are hashed in the bot's log lines (logIds: 'hash')
    logger: pino({ level: process.env.LOG_LEVEL ?? 'info' }),
  })

  bot.plug(slashCommandsPlugin)
  bot.when(['hi', 'hello'], (ctx) => ctx.reply('👋 Hi! Send "ticket" to open a support ticket.'))

  // 4. A persistent flow: a user halfway through it resumes after a restart or a deploy
  bot.use(
    flow('ticket')
      .ask('What is the problem?', 'issue')
      .ask('How can we reach you (email or phone)?', 'contact')
      .say((_ctx, c) => `🎫 Ticket created. We will contact you at ${c.state.contact}.`)
      .persistent()
      .timeout('1h'),
  )
  bot.onMessage((ctx) => ctx.reply('Send "ticket" to open a support ticket, or /help.'))

  // 5. Log what happened, never message bodies or phone numbers
  bot.on('conversation:ended', (e) => bot.logger.info({ flow: e.name, outcome: e.outcome, ms: e.durationMs }, 'conversation ended'))
  bot.on('error', ({ error }) => bot.logger.error({ err: error }, 'handler failed'))
  return bot
})

export default createBot

// 6. Liveness, readiness and Prometheus metrics on a private port
export function startHealthServer(bot, port = 9464) {
  let stopping = false
  bot.on('stopping', () => { stopping = true })
  const server = createServer((req, res) => {
    if (req.url === '/healthz') return void res.writeHead(200).end('ok')
    if (req.url === '/readyz') {
      const ready = !stopping && bot.getConnectionState() === 'ready'
      return void res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : 'not ready')
    }
    if (req.url === '/metrics') {
      return void res.writeHead(200, { 'content-type': PROMETHEUS_CONTENT_TYPE }).end(toPrometheus(bot.metrics()))
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

// 7. Graceful shutdown: finish the replies in flight, then close the health server
export function gracefulShutdown(bot, server) {
  let closing
  return (signal) => (closing ??= (async () => {
    bot.logger.info({ signal }, 'shutting down')
    await bot.stop({ drain: true, timeout: '15s' })
    await new Promise((resolve) => server.close(resolve))
  })())
}

// 8. `node src/bot.js` (or the container) runs this; `npx botmesh dev src/bot.js` only imports the factory
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: process.env.WA_SESSION ?? 'support-bot' }))
  const server = await startHealthServer(bot, Number(process.env.HEALTH_PORT ?? 9464))
  const shutdown = gracefulShutdown(bot, server)
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
  await bot.start()
}
```

## The project files

`package.json` (`npm install` adds the `dependencies`):

```json
{
  "name": "support-bot",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "start": "node --env-file-if-exists=.env src/bot.js",
    "dev": "botmesh dev src/bot.js"
  }
}
```

```dockerfile
# Dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# The WhatsApp session and the database live on volumes, never in the image
RUN mkdir -p /app/sessions /app/data && chown -R node:node /app
USER node
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:9464/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/bot.js"]
```

```text
# .dockerignore
node_modules
sessions
data
.env
*.qr.png
```

```yaml
# docker-compose.yml
services:
  bot:
    build: .
    restart: unless-stopped
    stop_grace_period: 30s          # longer than the 15 s drain
    environment:
      DB_FILE: /app/data/bot.db
      LOG_LEVEL: info
    volumes:
      - ./sessions:/app/sessions
      - ./data:/app/data
    ports:
      - '127.0.0.1:9464:9464'       # health and metrics, private
```

## How it works

### 1. One SQLite file for all state

`SQLiteStore` keeps messages, chats, contacts, user data and flow checkpoints.
Its folder must exist (SQLite creates the file, not the folders), hence the
`mkdirSync`. `maxMessagesPerChat` bounds the message log, which is unbounded
by default on persistent stores.

### 2. Durability

With `durability`, every admitted message is written to an inbox journal
before any handler runs, and every reply to an outbox under an idempotency
key before the provider is called. If the process dies halfway, the next
start replays the message and skips the replies that already went out.
`store.durability()` keeps both journals in the same file. Keep
`instanceId` stable across restarts of one deployment.

### 3. Logs without personal data

The bot logs through the pino logger you pass. Chat and sender ids are hashed
in the bot's own log lines (`logIds: 'hash'`, the default). Your own lines
should follow the same rule: step 5 logs the flow name, the outcome and the
duration, never the text or the phone number. `LOG_LEVEL=debug` shows more
while you debug.

### 4. Persistent flows

`.persistent()` saves the flow's position and `c.state` in the store after
each step, so a user halfway through `ticket` continues after a deploy. The
sample transcript below restarts the bot in the middle of the flow.

### 5. Events for operations

`'conversation:ended'` reports every flow with its outcome (`completed`,
`cancelled`, `timedOut`...). A `.persistent()` flow interrupted by a
restart reports `cancelled` and then continues from the store, so do not
alert on `cancelled` alone. `'error'` receives handler failures; send them to
your error tracker. See [Operations](/guide/operations) for the rest.

### 6. Health and metrics

`/healthz` answers while the process serves (liveness: restart the container
when it fails). `/readyz` answers `200` only while the bot is connected and
not stopping (readiness). `/metrics` is `bot.metrics()` in Prometheus text
format. Keep the port private: the compose file binds it to `127.0.0.1`.

### 7. Graceful shutdown

On `SIGTERM` (Docker, Kubernetes) or `SIGINT` (Ctrl+C, PM2), `bot.stop({ drain: true, timeout: '15s' })`
waits for the replies in flight, records them and closes the store; then the
health server closes and nothing keeps the process alive. A second signal
waits for the same shutdown. Keep the orchestrator's grace period
(`stop_grace_period`) longer than the drain timeout.

### 8. One file, three ways to run it

`npx botmesh dev src/bot.js` imports only the factory and injects the
terminal simulator, so you try the same bot (with the same SQLite file)
without a phone. `node src/bot.js` and the container run the
`isMainModule` block.

## Sample transcript

Captured with `LOG_LEVEL=silent npx botmesh dev src/bot.js`; with the
default `info` level, the `conversation ended` log lines of step 5 appear
between the replies. `:reset` starts a fresh bot, as
a restart or a deploy would, and the flow continues from the store:

```text
user › hi
bot › 👋 Hi! Send "ticket" to open a support ticket.
user › ticket
bot › What is the problem?
user › The app crashes on login
bot › How can we reach you (email or phone)?
• ↺ fresh bot — conversations and in-memory state cleared
user › ana@example.com
bot › 🎫 Ticket created. We will contact you at ana@example.com.
user › /ping
bot › pong 🏓
```

## Run it on WhatsApp

Locally: `npm start`, scan the QR with the phone that will be the bot, then
press Ctrl+C. With Docker, create the volume folders first (owned by your
user, uid 1000 like the image's `node` user), then follow the logs to scan
the QR the first time:

```bash
mkdir -p sessions data
docker compose up -d --build
docker compose logs -f bot
```

For Telegram, install `@botmesh/telegram` and build the bot with
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` instead.

## Next steps

- [Going to production](/guide/production): the full checklist
- [Deployment](/guide/deploy): PM2, backups and environment variables
- [Running N replicas](/guide/replicas): Redis, coordination and failover
- [Testing your bot](./testing-your-bot): cover the flows before each release
