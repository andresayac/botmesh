# @botmesh/mysql-store

Shared, persistent storage for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) on MySQL or MariaDB, through [mysql2](https://www.npmjs.com/package/mysql2). Point any number of bot replicas at the same database and they share message logs, chats, contacts, `.persistent()` flow checkpoints, `ctx.user` data, AI conversation history and delivery cursors.

- **Durable scheduled tasks** (`store.schedules()`, a `MysqlScheduleStore`): every occurrence is claimed by exactly one replica.
- Compare-and-set checkpoints (`setCheckpointIf`), used by `BotConfig.coordination`.
- Ids and keys compare **byte for byte** (`VARBINARY`), never through a case- or accent-insensitive collation.
- Tables are created on `start()` (`InnoDB`, `utf8mb4`, whatever the server defaults are). The package passes the same `IStore` conformance suite as every botmesh store.

There is no MySQL durability backend (`BotConfig.durability`); use `@botmesh/postgres-store`, `@botmesh/redis-store` or `@botmesh/sqlite-store` for that.

## Install

```bash
pnpm add @botmesh/mysql-store mysql2
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older alpha. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/mysql-store@beta mysql2` during the beta (`npm view @botmesh/mysql-store dist-tags` lists the tags). Once stable, the plain command above works.

[`mysql2`](https://www.npmjs.com/package/mysql2) `^3.11` is a **peer dependency**, loaded only when the store creates its own pool. You need a MySQL 8.x or MariaDB server reachable from the bot (for example `mysql://localhost:3306/botwa`); the database must exist, the store creates its tables.

## Quick start

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { MysqlStore } from '@botmesh/mysql-store'

const store = new MysqlStore({
  uri: process.env.MYSQL_URL, // default: mysql://localhost:3306/botwa
  tablePrefix: 'mybot_', // default: ''
})

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }), store })
await bot.start() // starts the store too: creates the pool and the tables
```

Discrete connection options work too: `new MysqlStore({ host: 'db.internal', port: 3306, user: 'bot', password: process.env.MYSQL_PASSWORD, database: 'botwa' })`. Combined with `uri` they override the matching parts of it, so `new MysqlStore({ uri: process.env.MYSQL_URL, password: process.env.MYSQL_PASSWORD })` keeps the URI's host and database. In a URI, percent-encode reserved characters in the user name and password (`#` → `%23`, `@` → `%40`, `/` → `%2F`, `?` → `%3F`, `:` → `%3A`); a URI with an unencoded `#`, or an `@` after the host (left there by an unencoded `/` or `?` in the password), is rejected. Using the store before it is started fails with an error that tells you to call `start()`.

### Bring your own pool

Pass an existing `mysql2/promise` pool: the store then never creates or closes it. It needs `query`, `getConnection` (for the short transactions behind the atomic upserts) and `end`, which every mysql2 pool has.

```ts
import { createPool } from 'mysql2/promise'

const pool = createPool(process.env.MYSQL_URL!)
const store = new MysqlStore({ pool })
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `uri` | `string` | `'mysql://localhost:3306/botwa'` | Connection URI (`mysql://` or `mariadb://`). Ignored when `pool` is given. A malformed URI throws a `TypeError` from the constructor that never repeats the URI (it holds the password). |
| `host`, `port`, `user`, `password`, `database` | `string` / `number` | none | Discrete connection options. With `uri` they override its matching parts; without it they are the whole config. |
| `pool` | `MysqlPoolLike \| NativeMysqlPool` | none | An existing pool. The store never creates or closes it; `start()` still creates the tables. |
| `tablePrefix` | `string` | `''` | Prefix for every table, so several bots share one database. Letters, digits and `_` only, at most 43 characters (MySQL names are limited to 64). |
| `maxMessagesPerChat` | `number` | unbounded | Keep only the newest N messages per chat; older rows are pruned on each save. |
| `purgeBatchSize` | `number` | `1000` | Rows deleted per statement by `bot.purgeExpiredUserData()`; the purge loops until nothing expired is left. |
| `logger` | `Partial<LoggerLike>` | none | Receives pool close failures and, through `warn` (else `error`), the notice about tables created by an early version (pino, `console` or the bot's logger). |

Invalid numbers throw a `RangeError` from the constructor.

## Durable scheduled tasks

```ts
const store = new MysqlStore({ uri: process.env.MYSQL_URL })
const bot = new Bot({ provider, store, scheduler: { store: store.schedules() } })

bot.schedule('0 9 * * 1-5', { id: 'daily-report', timeZone: 'Europe/Madrid' }, async (run) => {
  // run.occurrenceKey identifies this occurrence (runs are at least once)
})
```

- Table `{tablePrefix}schedules`. A claim runs `SELECT … FOR UPDATE` and an `UPDATE` in a short transaction on a dedicated connection, so concurrent claimers get exactly one winner; a deadlock victim is retried. `renew` and `complete` are single updates fenced by the token.
- Ids, specs and lease owners are `VARBINARY` (ids up to 1024 bytes, specs 2048, owners 512); longer values fail fast with a `RangeError`.
- `delete()` (`task.cancel()`, `bot.forgetTask(id)`) is a soft delete that keeps the id's fencing token; purge old tombstones by hand only when no runner can still hold their token (`DELETE FROM schedules WHERE deleted = 1 AND updated_at < <epoch ms a day ago>`).
- Times are whole milliseconds (a fractional slot or interval rounds up, a fractional `now` rounds down). Leases use the caller's clock, so keep replicas in sync (NTP). A standalone `new MysqlScheduleStore({ pool, tablePrefix })` borrows any pool and never closes it.

## Table layout

| Table | Key | Contents |
| --- | --- | --- |
| `messages` | `messageKey(ref)` | `StoredMessage` (`JSON`) plus `chat_id` and a `timestamp BIGINT` sort key; index `chat_ts (chat_id, timestamp)` |
| `chats` | chat id | `StoredChat` (`JSON`) |
| `contacts` | contact id | `StoredContact` (`JSON`) |
| `checkpoints` | key | `FlowCheckpoint` (`JSON`) |
| `conversations` | key | `@botmesh/ai` history (`AIMessage[]`, `JSON`) |
| `cursors` | key | delivery cursors (e.g. Telegram `update_id`), `WELCOME` markers, handoff index |
| `user_data` | user id + namespace + key | `ctx.user` entries (exact JSON text, optional expiry, indexed) |
| `schedules` | task id | durable scheduler tasks (`store.schedules()`) |

Every name gets the `tablePrefix`; keys are `VARBINARY(1024)`. A `VARCHAR` key would inherit the server collation (`utf8mb4_0900_ai_ci` on MySQL 8 is case- and accent-insensitive, so `abc` and `ABC` would share a row) and the `_bin` collations are `PAD SPACE`. All statements are parameterized.

### Upgrading tables created by an early version

`CREATE TABLE IF NOT EXISTS` never alters existing tables. Tables from before the switch to `VARBINARY` keys keep `VARCHAR(255)` columns and lack the `chat_ts` index; `start()` logs a warning naming them (the store keeps working). Upgrade them in place (bytes are preserved; replace `{p}` with your prefix):

```sql
ALTER TABLE `{p}messages` MODIFY id VARBINARY(1024) NOT NULL, MODIFY chat_id VARBINARY(1024) NOT NULL, ADD KEY chat_ts (chat_id, timestamp);
ALTER TABLE `{p}chats` MODIFY id VARBINARY(1024) NOT NULL;
ALTER TABLE `{p}contacts` MODIFY id VARBINARY(1024) NOT NULL;
ALTER TABLE `{p}checkpoints` MODIFY `key` VARBINARY(1024) NOT NULL;
ALTER TABLE `{p}conversations` MODIFY `key` VARBINARY(1024) NOT NULL;
ALTER TABLE `{p}cursors` MODIFY `key` VARBINARY(1024) NOT NULL;
```

## Errors you may see

| Error | Cause and fix |
| --- | --- |
| `needs the MySQL driver "mysql2", which is not installed` | Install the peer dependency (`pnpm add mysql2`), or pass your own `pool`. |
| `MysqlStore: pool is not available — call start() first` | The bot starts the store; if you use it on its own, `await store.start()` first. |
| `ER_BAD_DB_ERROR` (unknown database) | Create the database first: the store creates tables, not databases. |
| `CONSTRAINT … failed` on MariaDB | MariaDB stores `JSON` as `LONGTEXT` with a `json_valid()` check, which rejects documents nested deeper than 32 levels (a message's `raw` payload or a checkpoint's state). MySQL has no such limit. |
| `MysqlStore: cannot connect to MySQL at host:port (database "…"): ECONNREFUSED (…)` | No server is listening there, or a firewall drops the connection. The message names the target and the original error is the `cause` (`err.code` is kept). |
| ``MysqlStore: `uri` is not a valid URL`` / ``MysqlStore: `uri` contains "#"`` / ``MysqlStore: `uri` has an "@" after the host`` | Fix the URI shape (`mysql://user:password@host:3306/database`) and percent-encode reserved characters in the user name and password. |
| `No database selected` (`ER_NO_DB_ERROR`) | The URI has no `/database` path, or the discrete options have no `database`. |
| `RangeError: … key columns hold at most 1024 bytes` | An id or key longer than 1024 bytes in UTF-8 (the `VARBINARY(1024)` columns). Nothing is written. |
| `RangeError: a ctx.user value is … bytes` | A `ctx.user` value whose JSON is 16 MiB or more (the `MEDIUMTEXT` column). |
| `ETIMEDOUT` on Windows with Docker | Use `127.0.0.1` instead of `localhost`: `localhost` resolves to `::1` first and Docker Desktop's IPv6 forwarding never delivers the MySQL handshake. |

## Behaviour notes

- `upsertChat` / `upsertContact` shallow-merge exactly like `MemoryStore` (`{ ...existing, ...patch }`) and **atomically across processes**: each runs a short `SELECT … FOR UPDATE` transaction on a dedicated connection, and a deadlock victim is retried, so concurrent partial updates never lose fields.
- An auto-committed statement chosen as a deadlock victim (MariaDB's gap locks make concurrent saves and `maxMessagesPerChat` trims of one chat collide) is run again, up to 5 times. A statement of 1 MiB or more runs on a connection of its own, closed if the statement fails: a statement over the server's `max_allowed_packet` (16 MiB on MariaDB, 64 MiB on MySQL) makes the server drop the connection, and it must not go back to the pool. A statement that could not even be written to its connection (the server had already closed it) is sent again once; nothing that may have reached the server is ever re-sent.
- `deleteChat(chatId)` removes the chat **and** its message log in one transaction.
- `getMessagesByChat(chatId, limit)` returns the newest `limit` messages, oldest first (same windowing as the other stores).
- MySQL's `JSON` type rejects unpaired UTF-16 surrogates (text cut in the middle of an emoji): they are stored as U+FFFD instead of failing the write, in checkpoints too. Well-formed text round-trips unchanged.
- `timestamp` may be any number: the sort column gets `Math.floor(timestamp)` clamped to the safe-integer range, the document keeps the exact value.
- Message rows are keyed by `messageKey(ref)` (`{chatId}:{id}`, with `:` and `%` escaped), so ids containing `:` (such as Twilio's `whatsapp:+1…`) never collide. Rows written by older releases under the unescaped key are still found and moved on the next save.
- Tested against MySQL 8.4 and MariaDB 11.8 (the integration suites). The `VALUES(col)` upsert syntax also works on MySQL 5.7 and 8.0, which are not tested any more.

## Development

The unit tests run against an in-memory fake pool that models connections, transactions and row locks, with no network. Opt-in suites (`BOTWA_TEST_MYSQL_URL`) run the shared `IStore`, `ctx.user` and `ScheduleStore` conformance suites, the atomic merges and concurrency checks against a real server; see [CONTRIBUTING](https://github.com/andresayac/botmesh/blob/main/CONTRIBUTING.md#store-integration-tests-docker) for the Docker commands. The database user needs `CREATE`, `DROP`, `INDEX`, `SELECT`, `INSERT`, `UPDATE` and `DELETE`, plus read access to `information_schema`.

## Links

- [Persistent stores guide](https://andresayac.github.io/botmesh/guide/store) · [Scheduler](https://andresayac.github.io/botmesh/guide/scheduler) · [Running N replicas](https://andresayac.github.io/botmesh/guide/replicas) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/mysql-store/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/mysql-store) · [Issues](https://github.com/andresayac/botmesh/issues)
