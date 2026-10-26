# @botmesh/postgres-store

Shared, persistent storage for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) on PostgreSQL, through [node-postgres](https://node-postgres.com/) (`pg`). Point any number of bot replicas at the same database and they share message logs, chats, contacts, `.persistent()` flow checkpoints, `ctx.user` data, AI conversation history and delivery cursors.

It also carries the PostgreSQL pieces for **several replicas of one bot**:

- **Durable scheduled tasks** (`store.schedules()`, a `PostgresScheduleStore`): every occurrence is claimed by exactly one replica.
- **Durable inbox/outbox** (`PostgresDurability`, for `BotConfig.durability`): journaled inbound messages, idempotent sends and replay after a crash.
- Compare-and-set checkpoints (`setCheckpointIf`), used by `BotConfig.coordination`.

Documents are stored as `JSONB`; the tables are created on `start()`. The package passes the same `IStore` conformance suite as every botmesh store.

## Install

```bash
pnpm add @botmesh/postgres-store pg
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/postgres-store@beta pg` during the beta (`npm view @botmesh/postgres-store dist-tags` lists the tags). Once stable, the plain command above works.

[`pg`](https://www.npmjs.com/package/pg) `^8.13` is a **peer dependency**, loaded only when the store creates its own pool. You need a PostgreSQL server reachable from the bot (for example `postgres://localhost:5432/botwa`); the database must exist, the store creates its tables. The package's types never name `pg`, so TypeScript projects need no `@types/pg`.

## Quick start

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { PostgresStore } from '@botmesh/postgres-store'

const store = new PostgresStore({
  connectionString: process.env.DATABASE_URL, // default: postgres://localhost:5432/botwa
  tablePrefix: 'mybot_', // default: ''
})

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }), store })
await bot.start() // starts the store too: creates the pool and the tables
```

Using the store before it is started fails with an error that tells you to call `start()`, also with an injected `pool`. `stop()` ends only a pool the store created: a store on an injected `pool` keeps working after `stop()`, so several bots can share one store (or one `PostgresDurability`) and stopping one does not break the others, as with the Redis, MySQL and MongoDB stores. After `stop()`, an own-pool store can be started again; a `stop()` that arrives while `start()` is still connecting waits for it and ends the new pool.

### Bring your own pool

Pass an existing `pg` `Pool` (or anything with `query(text, values)` and `end()`): the store then never creates or ends it.

```ts
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
pool.on('error', (err) => console.error('idle client error', err)) // required, see below
const store = new PostgresStore({ pool })
```

node-postgres emits `'error'` on the pool when an **idle** client loses its connection (server restart, failover), and with no listener that crashes the process. The store adds the listener only to a pool it creates itself (and reports through `logger`). One pool can be shared by the store, the schedule store and the durability backend.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `connectionString` | `string` | `'postgres://localhost:5432/botwa'` | Connection URL. Ignored when `pool` is given. |
| `pool` | `PostgresPoolLike \| NativePostgresPool` | none | An existing pool. The store never creates or ends it; `start()` still creates the tables. |
| `tablePrefix` | `string` | `''` | Prefix for every table (`'mybot_'` → `mybot_messages`), so several bots share one database. Letters, digits and `_` only, at most 42 characters (PostgreSQL cuts names at 63 bytes). |
| `maxMessagesPerChat` | `number` | unbounded | Keep only the newest N messages per chat; older rows are pruned on each save. |
| `purgeBatchSize` | `number` | `1000` | Rows deleted per statement by `bot.purgeExpiredUserData()`; the purge loops until nothing expired is left. |
| `logger` | `Partial<LoggerLike>` | none | Receives pool end failures and the idle-client errors of a store-created pool (pino, `console` or the bot's logger). |

Invalid numbers and a `tablePrefix` longer than 42 characters throw a `RangeError`, and a `tablePrefix` with other characters an `Error`, from the constructor.

## Durable scheduled tasks and message processing

```ts
import pg from 'pg'
import { PostgresDurability, PostgresStore } from '@botmesh/postgres-store'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
pool.on('error', (err) => console.error(err))
const store = new PostgresStore({ pool })

const bot = new Bot({
  provider,
  store,
  scheduler: { store: store.schedules() }, // durable bot.schedule/every/delay tasks (registered with an id)
  durability: { backend: new PostgresDurability({ pool }), instanceId: process.env.HOSTNAME },
})

bot.schedule('0 9 * * 1-5', { id: 'daily-report', timeZone: 'America/Bogota' }, async (run) => {
  // run.occurrenceKey identifies this occurrence (runs are at least once)
})
```

- **Scheduler** (`{tablePrefix}schedules`): every operation is one atomic statement (`INSERT … ON CONFLICT`, `UPDATE … RETURNING`), so a claim has exactly one winner across replicas. `delete()` (`task.cancel()`, `bot.forgetTask(id)`) is a soft delete that keeps the id's fencing token; purge old tombstones by hand only when no runner can still hold their token (`DELETE FROM schedules WHERE deleted AND updated_at < <epoch ms a day ago>`). Times are whole milliseconds: a fractional slot or interval rounds up, a fractional `now` rounds down. Leases use the caller's clock, so keep replicas in sync (NTP). A standalone `new PostgresScheduleStore({ pool, tablePrefix })` borrows any pool and never ends it.
- **Durability** (`{tablePrefix}durable`, created by the backend's `start()`, which the bot calls): every state change is an `UPDATE … WHERE version = $n`, so two replicas never claim the same record and a stale lease holder's completion is rejected by its fencing token. `PostgresDurableKv` is the same table as a plain `DurableKv` for your own durable records.

| `PostgresDurability` option | Default | Description |
| --- | --- | --- |
| `pool` | none | An existing pool (shared with the store). Never ended by the backend. |
| `connectionString` | `'postgres://localhost:5432/botwa'` | Used to create a pool when `pool` is not given; `stop()` ends it. |
| `tablePrefix` | `''` | Prefix for the `durable` table (same rules as the store's). |
| `logger` | none | Receives the idle-client errors of a pool the backend created, and a failure to end it on `stop()`. |

## Table layout

| Table | Key | Contents |
| --- | --- | --- |
| `messages` | `messageKey(ref)` | `StoredMessage` (`JSONB`) plus `chat_id` and a `timestamp BIGINT` sort key; indexed by `(chat_id, timestamp)` |
| `chats` | chat id | `StoredChat` (`JSONB`) |
| `contacts` | contact id | `StoredContact` (`JSONB`) |
| `checkpoints` | key | `FlowCheckpoint` (`JSONB`) |
| `conversations` | key | `@botmesh/ai` history (`AIMessage[]`, `JSONB`) |
| `cursors` | key | delivery cursors (e.g. Telegram `update_id`), `WELCOME` markers, handoff index |
| `user_data` | user id + namespace + key | `ctx.user` entries (exact JSON text, optional expiry, indexed) |
| `schedules` | task id | durable scheduler tasks (`store.schedules()`) |
| `durable` | table + id | durability journals (`PostgresDurability`) and other `DurableKv` documents |

Every name gets the `tablePrefix`. Schema creation is idempotent (`CREATE TABLE IF NOT EXISTS`), and replicas booting at the same moment retry a lost catalog race (`23505`, `42P07`, `42710`) instead of failing. All statements are parameterized.

## Errors you may see

| Error | Cause and fix |
| --- | --- |
| `needs the PostgreSQL driver "pg", which is not installed` | Install the peer dependency (`pnpm add pg`), or pass your own `pool`. |
| `PostgresStore is not started — call start() before using it` | The bot starts the store; if you use it on its own, `await store.start()` first. |
| `invalid tablePrefix` | Use a plain SQL identifier prefix (`[A-Za-z_][A-Za-z0-9_]*`). |
| `tablePrefix "…" is N characters long; use at most 42` | PostgreSQL truncates table and index names to 63 bytes, and a longer prefix made two tables share one name. Use a shorter prefix. |
| `code: '22021'` (invalid byte sequence) | An id or key contains U+0000, which PostgreSQL `TEXT` rejects. Ids must not contain it. (A lone UTF-16 surrogate in an id is stored as U+FFFD, so the message is still found, under the replaced id.) |
| `ECONNREFUSED` / timeouts on Windows with Docker | Use `127.0.0.1` instead of `localhost`: `localhost` resolves to `::1` first and Docker Desktop's IPv6 forwarding can hang. |

## Behaviour notes

- `upsertChat` / `upsertContact` **shallow-merge on the server** (`data - <keys set to undefined> || patch`), so concurrent partial updates from several replicas never drop each other's fields.
- `deleteChat(chatId)` removes the chat **and** its message log in one statement.
- `getMessagesByChat(chatId, limit)` returns the newest `limit` messages, oldest first (same windowing as the other stores). Order among messages with the same millisecond is not defined.
- `JSONB` cannot hold U+0000 or unpaired UTF-16 surrogates (text cut in the middle of an emoji): in messages, chats, contacts, checkpoints and conversations they are stored as U+FFFD instead of failing the write. `ctx.user` values are stored exactly (as JSON text, so U+0000 travels escaped).
- `timestamp` may be any number: the sort column gets `Math.floor(timestamp)`, the document keeps the exact value.
- Message rows are keyed by `messageKey(ref)` (`{chatId}:{id}`, with `:` and `%` escaped), so ids containing `:` (such as Twilio's `whatsapp:+1…`) never collide. Rows written by older releases under the unescaped key are still found and moved on the next save.
- Nothing expires on its own (unlike `@botmesh/redis-store`): delete messages, chats and cursors explicitly, or cap the logs with `maxMessagesPerChat`.

## Development

The unit tests run against in-memory fake pools, with no network. Opt-in suites (`BOTWA_TEST_POSTGRES_URL`) run the shared `IStore`, `ctx.user` and `ScheduleStore` conformance suites, the durability journals, replica hand-over and concurrency checks against a real PostgreSQL; see [CONTRIBUTING](https://github.com/andresayac/botmesh/blob/main/CONTRIBUTING.md#store-integration-tests-docker) for the Docker commands.

## Links

- [Persistent stores guide](https://andresayac.github.io/botmesh/guide/store) · [Scheduler](https://andresayac.github.io/botmesh/guide/scheduler) · [Durable processing](https://andresayac.github.io/botmesh/guide/durability) · [Running N replicas](https://andresayac.github.io/botmesh/guide/replicas) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/postgres-store/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/postgres-store) · [Issues](https://github.com/andresayac/botmesh/issues)
