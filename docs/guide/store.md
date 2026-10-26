# Persistent store

The **store** is where the bot keeps messages, chats, contacts, flow
checkpoints, AI conversation history and [`ctx.user`](./user-data) data. With
the default in-memory store a restart forgets all of it; with a persistent one
the bot picks up where it left off.

Every store implements the transport-neutral `IStore` contract of
`@botmesh/core`, so the same store works with any channel.

## Choosing a store

| Store | Package | Where the data lives | Use it for |
|---|---|---|---|
| `MemoryStore` *(default)* | `@botmesh/core` | Process memory (optional JSON snapshot) | Development and tests |
| `SQLiteStore` | `@botmesh/sqlite-store` | One SQLite file | **Production with one process** |
| `RedisStore` | `@botmesh/redis-store` | A Redis server or Redis Cluster | **Production with several replicas** |
| `PostgresStore` · `MysqlStore` · `MongoStore` | `@botmesh/postgres-store` · `@botmesh/mysql-store` · `@botmesh/mongo-store` | PostgreSQL / MySQL or MariaDB / MongoDB | **Several replicas** on the database you already run (see [below](#postgresql-mysql-and-mongodb)) |

Rules of thumb:

- One bot process on a VPS or in a container: **`SQLiteStore`**. No server to
  run, one file to back up.
- Several processes of the same bot ([replicas](./replicas)), or state that
  other services read: **`RedisStore`**. Every replica must see the same data,
  so `MemoryStore` and `SQLiteStore` do not fit there. If you already run
  PostgreSQL, MySQL/MariaDB or MongoDB, the matching store does the same job.
- Always pass a store **instance** (`store: new SQLiteStore({ … })`). A string
  such as `store: 'sqlite'` is accepted only for compatibility and still creates
  a `MemoryStore`.

The bot calls the store's `start()` and `stop()` for you.

## MemoryStore

Without a `store` option the bot creates a `MemoryStore`. Everything lives in
RAM. An optional JSON file snapshots chats, contacts, flow checkpoints, AI
conversations and `ctx.user` data (not messages) on an interval and on
`stop()`:

```ts
import { Bot, MemoryStore } from '@botmesh/core'

const bot = new Bot({
  provider,
  store: new MemoryStore({
    file: './store.json',     // optional snapshot
    autoSaveInterval: '1m',   // a duration or ms; 0 disables the timer
    maxMessagesPerChat: 1000, // the default; Infinity removes the cap
  }),
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `file` | `string` | — | JSON file loaded on start and saved on the interval and on `stop()` |
| `autoSaveInterval` | `string \| number` | `60000` | Save period of `file`; `0` disables it |
| `maxMessagesPerChat` | `number` | `1000` | Newest messages kept per chat; `Infinity` keeps all of them |
| `logger` | `MemoryStoreLogger` | — | Receives load and save failures |

The message log is capped at 1000 messages per chat by default because it
lives in RAM. The persistent stores have no cap unless you set one.

::: warning Messages are not restored
The JSON snapshot skips the message log on purpose (size and privacy). Use
`SQLiteStore` or `RedisStore` when the history must survive a restart.
:::

## SQLiteStore

A real database in one file, on
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3). `better-sqlite3`
is a peer dependency, so install it next to the store:

```bash
pnpm add @botmesh/sqlite-store better-sqlite3
```

While botmesh is in prerelease, add the dist-tag shown in
[Installation](./getting-started) to the `@botmesh/*` packages.

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'my-bot' }),
  store: new SQLiteStore({ file: './data/bot.db' }),
})
```

The folder of `file` must exist: SQLite creates the file, not its folders.

### Installing better-sqlite3

`better-sqlite3` is a native module. The supported range is
`^11.7.0 || ^12.0.0 || ^13.0.0`, and the store is tested against all three.

::: warning Node.js 24.19 or later: use better-sqlite3 13
Versions 11 and 12 can abort the process (`Assertion failed: (env) != nullptr`
in `RemoveEnvironmentCleanupHook`) when a prepared statement is
garbage-collected, because of a Node.js regression
([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)). Version 13
runs on N-API and is not affected.
:::

| Error when the store is constructed | Fix |
|---|---|
| `better-sqlite3` is not installed | `pnpm add better-sqlite3` |
| `better-sqlite3 is installed but its native module was never built` | pnpm 10 and later skip dependency build scripts. Run `pnpm approve-builds` once (or, in `pnpm-workspace.yaml`, set `allowBuilds:` with `better-sqlite3: true` on pnpm 11, or list it under `onlyBuiltDependencies` on pnpm 10) and reinstall. |
| The binary was built for another Node.js version | `npm rebuild better-sqlite3` (after a Node.js upgrade) |
| The folder does not exist | Create the folder of `file` |
| `SQLITE_NOTADB` | `file` points at something that is not a SQLite database |

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `file` | `string` | `'./bot.db'` | Database file. `':memory:'` is an in-memory database that `stop()` keeps open (closing it would lose its data). |
| `wal` | `boolean` | `true` | WAL journal mode (readers do not block the writer) |
| `maxMessagesPerChat` | `number` | — (no cap) | Keep only the newest N messages per chat; older rows are pruned on save |
| `busyTimeoutMs` | `number` | `5000` | How long a statement waits for another connection's lock before `SQLITE_BUSY` |
| `purgeBatchSize` | `number` | `1000` | Rows deleted per statement by `purgeExpiredUserData` (it loops until nothing expired is left) |
| `logger` | `Partial<LoggerLike>` | — | Receives close failures and schema migration notes (pino or `bot.logger`) |

An invalid number (negative, fractional) throws a `RangeError` from the constructor.

### What it stores

| Table | Content |
|---|---|
| `messages` | Inbound and outbound messages, indexed by chat and timestamp |
| `chats`, `contacts` | Chat and contact metadata |
| `checkpoints` | `.persistent()` flow checkpoints, including `c.state` |
| `conversations` | AI conversation history (`@botmesh/ai`) |
| `cursors` | Delivery cursors (Telegram's `update_id`), `WELCOME` markers and the handoff index |
| `user_data` | [`ctx.user`](./user-data) entries |
| `schedules`, `schedule_fences` | [Durable scheduler](./scheduler#durable-tasks-survive-restarts-one-replica-per-run) tasks (`store.schedules()`) |
| `durable` | [Durability](./durability) journals (`store.durability()`) |

### Schema versions and upgrades

The file records its layout in `PRAGMA user_version`; `SQLITE_SCHEMA_VERSION`
is the version this release writes. Opening a file runs the pending migrations
in order, each in its own transaction, so a database written by an earlier
release is upgraded in place with its rows kept. You never create or migrate
tables by hand.

A file written by a **newer** release is refused, untouched, with
`SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`, with `found` and
`supported`). Downgrades are not supported, so:

- **Back up the file before upgrading** `@botmesh/sqlite-store` if you may need
  to roll back.
- When several processes share one file, stop the ones on the old version
  before a new one opens it.

The [package README](https://www.npmjs.com/package/@botmesh/sqlite-store#schema-versioning)
lists what each version changed and how to roll back the latest step without a
backup.

### Lifecycle

`bot.stop()` (and a failed `bot.start()`) closes the database, and the next
`bot.start()` reopens it, so one `SQLiteStore` instance, with the `schedules()`
and `durability()` backends it handed out, survives stop/start cycles.

SQLite stores text as UTF-8, where a lone UTF-16 surrogate becomes U+FFFD and
two different ids could share a row. `saveMessage` and `setCursor` reject such
an id, key or cursor value with a `TypeError`.

## Persistent flows

With a persistent store, `flow(...).persistent()` checkpoints survive a restart:

```ts
import { Bot, flow } from '@botmesh/core'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({ provider, store: new SQLiteStore({ file: './data/bot.db' }) })

bot.use(
  flow('signup')
    .persistent()                 // checkpoint saved after each step
    .ask('What is your name?', 'name')
    .ask('And your email?', 'email')
    .say((_ctx, c) => `Thanks, ${c.state.name}!`),
)
```

If the process stops in the middle of the flow, the user's next message
**resumes it at the step where it stopped**. That message only wakes the flow:
the pending question is sent again (`And your email?` above) and the user's
next reply is its answer. With [durability](./durability) the waking message is
taken as the answer instead.

A checkpoint is written when the flow starts and after every step, so even a
flow still waiting on its **first** question resumes there. A restart in the
middle of a [`.form()`](./forms) asks the form again from its first field: the
whole form is one step.

## RedisStore

State shared by every process of a bot, on Redis (node-redis 4, 5 or 6 as a
peer dependency):

```bash
pnpm add @botmesh/redis-store redis
```

```ts
import { Bot } from '@botmesh/core'
import { RedisStore } from '@botmesh/redis-store'

const bot = new Bot({
  provider,
  store: new RedisStore({ url: process.env.REDIS_URL, prefix: 'mybot', sessionTtl: '7d' }),
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `redis://localhost:6379` | Connection URL; ignored with `client` |
| `prefix` | `string` | `'botwa'` | Prefix of every key. Choose it once: data stored under one prefix is not seen under another. |
| `client` | node-redis client or cluster | — | An existing client. The store never connects or closes it; give it an `'error'` listener. |
| `cluster` | `{ rootNodes, … }` | — | Create and own a cluster client (see [Redis Cluster](./redis-cluster)) |
| `sessionTtl` | `string \| number` | — (no expiry) | Expiry of AI conversations and flow checkpoints (`'24h'`, `'7d'` or ms). Messages, chats, contacts and cursors never expire. |
| `maxMessagesPerChat` | `number` | — (no cap) | Keep only the newest N messages per chat |
| `logger` | `{ error?, warn? }` | — | Receives connection errors of a client the store created |

The same `RedisStore` hands out the other Redis backends, all on its client and
prefix: `store.coordinator()` for [replicas](./replicas), `store.schedules()` and
`store.leases()` for the [durable scheduler](./scheduler#backends). The
durability backend is `new RedisDurability({ client, prefix })` (see
[Durable message processing](./durability#backends)).

An injected client without an `'error'` listener crashes the process on the
first dropped connection (node-redis rethrows the event), so always attach one.
The key scheme and every other detail are in the
[package README](https://www.npmjs.com/package/@botmesh/redis-store).

## PostgreSQL, MySQL and MongoDB

`@botmesh/postgres-store`, `@botmesh/mysql-store` and `@botmesh/mongo-store`
keep the bot state in the database you already operate, shared by any number of
replicas. They pass the same conformance suite as the other stores, create their
tables (or indexes) on `start()` and provide a durable [schedule store](./scheduler)
(`store.schedules()`). PostgreSQL also has a [durability](./durability) backend,
`PostgresDurability`.

The database driver is a peer dependency, loaded only when the store creates its
own pool or client:

```bash
pnpm add @botmesh/postgres-store pg      # PostgreSQL
pnpm add @botmesh/mysql-store mysql2     # MySQL 8.x or MariaDB
pnpm add @botmesh/mongo-store mongodb    # MongoDB (driver 6.x or 7.x)
```

```ts
import { PostgresStore } from '@botmesh/postgres-store'
import { MysqlStore } from '@botmesh/mysql-store'
import { MongoStore } from '@botmesh/mongo-store'

const store = new PostgresStore({ connectionString: process.env.DATABASE_URL, tablePrefix: 'mybot_' })
// or: new MysqlStore({ uri: process.env.MYSQL_URL, tablePrefix: 'mybot_' })
// or: new MongoStore({ url: process.env.MONGO_URL, dbName: 'mybot' })

const bot = new Bot({ provider, store, scheduler: { store: store.schedules() } })
```

Each one also takes an existing pool or client (`pool` / `client`), which it
never closes. With an injected `pg` pool, attach a `pool.on('error', …)`
listener: node-postgres crashes the process when an idle connection drops and
nobody listens. On PostgreSQL keep `tablePrefix` at 42 characters or fewer (the
server truncates names to 63 bytes; a longer prefix throws a `RangeError`). The
options, table layouts and error tables are in each package README: [PostgreSQL](https://www.npmjs.com/package/@botmesh/postgres-store),
[MySQL/MariaDB](https://www.npmjs.com/package/@botmesh/mysql-store),
[MongoDB](https://www.npmjs.com/package/@botmesh/mongo-store).

## User data tables

[`ctx.user`](./user-data) profiles are stored next to the rest of the bot
state, honouring `tablePrefix` / `collectionPrefix`:

| Store | Where |
| --- | --- |
| `MemoryStore` | in memory; the JSON `file` gains a `userData` field (older files still load) |
| `SQLiteStore` | table `user_data` (`user_id`, `namespace`, `key`, `value_json`, `expires_at`, `updated_at`) + index on `expires_at` |
| `RedisStore` | one key per entry, `{prefix}:ud:{user}:{ns}:{key}`, with native `PX` expiry; listings use incremental `SCAN` |
| `PostgresStore` | table `{prefix}user_data` (value as `TEXT`, not JSONB, so the exact JSON round-trips) + expiry index |
| `MysqlStore` | table `{prefix}user_data`: ids, namespace and key as `VARBINARY` (byte-exact), value `MEDIUMTEXT` (16 MiB) |
| `MongoStore` | collection `{prefix}user_data`, indexes on `{ userId, namespace }` and `expiresAt` |

Expired entries are removed lazily by `bot.purgeExpiredUserData()` (Redis
expires them by itself). The SQL and Mongo stores delete them in batches of
`purgeBatchSize` (default `1000`) until nothing expired is left, so a large
backlog never runs as one long delete.

## Writing your own store

Implement `IStore` to plug in another backend. Store authors import the
contract and its helpers from `@botmesh/core/spi`:

```ts
import type { MessageRef } from '@botmesh/core'
import type { IStore, StoredMessage } from '@botmesh/core/spi'

class MyStore implements IStore {
  async start(): Promise<void> { /* connect */ }
  async stop(): Promise<void> { /* disconnect */ }
  async saveMessage(msg: StoredMessage): Promise<void> { /* … */ }
  async getMessage(ref: MessageRef): Promise<StoredMessage | undefined> { /* … */ }
  // …every other required method of IStore
}
```

The full interface is in the [API reference](/api/interfaces/_botmesh_core.IStore.html).
`MemoryStore` is the reference implementation, and inside the monorepo every
store runs the shared conformance suite (`test-utils/store-conformance.ts`).

Semantics every store must keep:

- `upsertChat` / `upsertContact` **shallow-merge** onto the stored record. An
  own field set to `undefined` **unsets** that field, so a partial upsert must
  omit what it does not know. The bot already does: a message without a
  display name never erases the stored one.
- `deleteChat` also deletes that chat's message log.
- `getMessagesByChat(chatId, limit)` returns the newest `limit` messages,
  **oldest first** (default `50`). A `limit` of `0` or less returns nothing, a
  fraction rounds up and `Infinity` returns the whole log. The persistent stores
  order by `timestamp`, so re-saving a message with a new timestamp moves it;
  `MemoryStore` keeps a re-saved message at the position of its first save.
- `saveMessage` ignores a message without `ref.id` or `chatId` (providers send
  `ref.id: ''` when they have no stable id), and `getMessage` of such a ref
  resolves `undefined`. Re-saving an id replaces the stored message.
- `maxMessagesPerChat` is opt-in in persistent stores. Reject a negative or
  fractional cap with a `RangeError`.
- `setUserData` rejects with a `TypeError` when the value is not JSON
  (`undefined`), and writes nothing.
- Message rows are keyed by `messageKey(ref)` (from `@botmesh/core/spi`):
  `{chatId}:{id}` with `%` and `:` escaped in each part (`%25`, `%3A`), so ids
  that contain `:` (Twilio's `whatsapp:+1…` chat ids) never collide. Rows
  written under the older unescaped key (`legacyMessageKey(ref)`) must still be
  read and deleted, after checking that the row's stored `ref.id` and
  `ref.chatId` are the requested message, and re-saving moves them to the new
  key.

Optional methods:

- **User data** (`getUserData`, `setUserData`, `deleteUserData`,
  `listUserData`, `purgeExpiredUserData`): without them `ctx.user` rejects with
  `UNSUPPORTED_STORE`. Check them with `test-utils/user-data-conformance.ts`.
- **Cursors** (`getCursor`/`setCursor`): they also persist the
  [`WELCOME`](./triggers#welcome) markers and the [handoff](./handoff) index.
- **Conditional checkpoints** (`setCheckpointIf`/`clearCheckpointIf`): needed
  for a safe hand-over between [replicas](./replicas). Without them the bot logs
  a warning when coordination is on.

## Docker

Mount the data folder as a volume so the database survives container
restarts. See [Deployment](./deploy#docker-compose-yml) for the full setup and
[Backups](./deploy#backups).
