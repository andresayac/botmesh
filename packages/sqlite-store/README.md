# @botmesh/sqlite-store

SQLite [`IStore`](https://github.com/andresayac/botmesh/tree/main/packages/core) implementation for **@botmesh/core**: persistent bot state in a single file, backed by [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). Message logs, chats, contacts, flow checkpoints, AI conversation history and delivery cursors survive restarts with no server to run.

> **Alpha, published under the `alpha` dist-tag.** Install it with the tag (`pnpm add @botmesh/sqlite-store@alpha`); `changeset publish` does not create a `latest` tag.

- One file, zero config. Tables are created on construction (`CREATE TABLE IF NOT EXISTS`), so there are no migrations to run by hand.
- **WAL** journal mode by default (`synchronous = NORMAL`) for better concurrent reads.
- `getMessagesByChat(limit)` is served by a `(chat_id, timestamp)` index and returns the most recent `limit` messages **oldest→newest**, the same windowing semantics as `@botmesh/redis-store`.
- Optional per-chat cap (`maxMessagesPerChat`) to bound growth; unbounded by default, since a persistent DB is often the full archive.
- Passes the shared `IStore` conformance suite (`test-utils/store-conformance.ts`), like every other store.

Best fit: a **single bot process** on a VPS or in a container. For several replicas sharing state, use `@botmesh/redis-store`.

## Install

```bash
pnpm add @botmesh/sqlite-store better-sqlite3
```

`better-sqlite3` is a peer dependency, a native module with prebuilt binaries for common platforms. It is loaded when the store is constructed; if it is missing, the constructor throws an error telling you to install it.

**pnpm 10+ skips dependency build scripts** (the step that fetches that binary) until you approve them: run `pnpm approve-builds` once, or add `onlyBuiltDependencies: [better-sqlite3]` to `pnpm-workspace.yaml`, and reinstall. Otherwise the constructor throws `better-sqlite3 is installed but its native module was never built`. A binary built for another Node.js version gets its own message (`npm rebuild better-sqlite3`).

**Use `better-sqlite3` 13 on Node.js 24.19 or later.** Versions 11 and 12 are built on `node::ObjectWrap`, and a Node.js 24.19 regression ([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)) can abort the process with `Assertion failed: (env) != nullptr` in `RemoveEnvironmentCleanupHook` when a prepared statement is garbage-collected. Version 13 runs on N-API and is not affected. The peer range still accepts 11 and 12 for older Node.js versions.

The supported range is `^11.7.0 || ^12.0.0 || ^13.0.0`; the store is exercised against all three majors.

## Usage with Bot

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'demo' }),
  store: new SQLiteStore({ file: './data/bot.db' }),
})

await bot.start()
```

The bot calls the store's `start()`/`stop()` for you. `stop()` closes the database (a close failure goes to `logger.error`) and `start()` reopens it, so the same store survives `bot.stop()` / `bot.start()` cycles and a failed start (the `schedules()` and `durability()` backends follow the new connection). Both are idempotent. Calling `schedules()` or `durability()` on a stopped store reopens it the same way. A message id, chat id, cursor key or cursor value with a lone UTF-16 surrogate is rejected with a `TypeError` (SQLite would store it as U+FFFD, where it could collide with another id). An in-memory database (`file: ':memory:'` or `''`) stays open on `stop()`, since closing it would discard its data.

Opening errors name the file: a missing directory (`file`'s folder must exist), a file that is not a SQLite database (`code: 'SQLITE_NOTADB'`, the handle is released) or a native module that was never built.

With a durable store, `flow(...).persistent()` checkpoints survive a restart: the next message from that user resumes the flow at the saved step.

## Configuration

| Option               | Type          | Default      | Description |
| -------------------- | ------------- | ------------ | ----------- |
| `file`               | `string`      | `'./bot.db'` | Path to the SQLite database file. The directory must exist (the error says so and names the path). |
| `wal`                | `boolean`     | `true`       | Enable WAL journal mode. |
| `maxMessagesPerChat` | `number`      | — (unbounded) | Keep only the newest N messages per chat; older rows are pruned on each `saveMessage`. Must be a non-negative integer (else `RangeError`). |
| `purgeBatchSize` | `number` | `1000` | Rows deleted per statement by `purgeExpiredUserData`; the purge loops until nothing expired is left, so a large backlog never runs as one long delete. Must be a positive integer (else `RangeError`). |
| `busyTimeoutMs`      | `number`      | `5000`       | How long a statement waits for another connection's lock before `SQLITE_BUSY` (`PRAGMA busy_timeout`). Must be a non-negative integer (else `RangeError`). |
| `logger`             | `Partial<LoggerLike>` | —    | Receives lifecycle errors (close failure) and schema migration notes; pino or the bot's logger fit, every method is optional. |

## Schema versioning

The file records its layout in `PRAGMA user_version`; `SQLITE_SCHEMA_VERSION` is
the version this release writes (`2`). Opening a database runs the pending
migrations in order, each in its own `IMMEDIATE` transaction together with the
version bump, so a failed step leaves the file at the last completed version and
two processes opening one file never run a step twice. Files written before
versioning existed (version `0`, up to `0.2.0-alpha.0`) are upgraded in place
with every row kept. Version `2` adds the durable scheduler's tables
(`schedules`, `schedule_fences`) and the durability table (`durable`), which
earlier releases created ad hoc on the first `schedules()` / `durability()` call:
they are now created when the file is opened, and existing rows are kept.

A file written by a newer release is refused, untouched, with
`SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`, `found`,
`supported`). Downgrades are not supported: back up the file before an upgrade
you may need to roll back. In particular, once this release opens a file it is
at version `2`, and the previous alpha (version `1`) refuses it on its next
start even if the app never uses schedules or durability. Stop every process on
the old version before the new one opens a shared file. The version `2` step
only adds tables, so without a backup `PRAGMA user_version = 1` (set with the
`sqlite3` CLI while nothing has the file open) makes it readable by the
previous alpha again.

## Table layout

| Table           | Key                                 | Contents |
| --------------- | ----------------------------------- | -------- |
| `messages`      | `messageKey(ref)` (`{chatId}:{id}`, escaped) | `StoredMessage` as JSON, plus `chat_id`, `sender_id`, `timestamp`, `type`, `body`, `from_me` columns; indexed by `(chat_id, timestamp)` |
| `chats`         | `chat.id`                           | `StoredChat` (JSON) |
| `contacts`      | `contact.id`                        | `StoredContact` (JSON) |
| `checkpoints`   | key                                 | `FlowCheckpoint` (JSON: flow id, step, `c.state`) |
| `conversations` | key                                 | `AIMessage[]` (JSON), the `@botmesh/ai` history |
| `cursors`       | key                                 | delivery cursor string (e.g. Telegram `update_id`) |
| `schedules`     | task id                             | durable scheduler tasks (`store.schedules()`): spec, next/last run, fencing token, lease |
| `schedule_fences` | task id                           | last fencing token of each deleted durable task (tokens never go backwards) |

## Semantics

- `upsertChat` / `upsertContact` **shallow-merge** over the existing record, so a partial upsert never wipes fields set earlier. The read and the write run in one `IMMEDIATE` transaction, so concurrent upserts of the same record (from this process or another one sharing the file) never drop each other's fields.
- `deleteChat(chatId)` removes the chat **and** purges its message log in one transaction (consistent with `MemoryStore`).
- `saveMessage` is an upsert keyed by `messageKey(ref)`; re-saving a message replaces it. A message without `ref.id` or `chatId` is ignored, like in `MemoryStore`.
- `getMessagesByChat(chatId, limit)`: a `limit` of `0` or less returns nothing, a fraction rounds up and `Infinity` returns the whole log.
- Statements are prepared once per store, not on every call.
- `purgeExpiredUserData` deletes `purgeBatchSize` rows per statement and yields to the event loop between batches, so a large backlog never blocks the bot (better-sqlite3 is synchronous) or holds the write lock for long.
- **Message keys.** `messageKey(ref)` (from `@botmesh/core`) is `{chatId}:{id}` with `%` and `:` percent-escaped in each part (`%25`, `%3A`), so ids that contain `:` — Twilio's `whatsapp:+1…` chat ids — never collide (`('a:b', 'c')` and `('a', 'b:c')` used to share the key `a:b:c`). Ids without `:` or `%` keep exactly the key earlier versions wrote. Rows written by an earlier version under the old unescaped key are still read and deleted (a fallback that only runs for ids containing `:` or `%`, and only returns or deletes a row whose stored `ref` is that very message, since a legacy key can be another message's new key), and re-saving such a message moves it to the new key — no manual migration. One theoretical edge remains: an id that literally contains `%3A` and was stored by an earlier version can be overwritten by a new message whose id has `:` in the same place.

## Durable scheduler tasks

`store.schedules()` returns a `ScheduleStore` on the same connection (table `schedules`, created with the schema) for durable `bot.schedule/every/delay` tasks, the ones registered with an `id`:

```ts
const store = new SQLiteStore({ file: './data/bot.db' })
const bot = new Bot({ provider, store, scheduler: { store: store.schedules() } })
bot.schedule('0 9 * * *', { id: 'daily-report', missed: 'run-once' }, async (run) => { /* ... */ })
```

Their next run survives restarts. Claims run in `BEGIN IMMEDIATE` transactions, so several processes sharing the file never run the same occurrence twice (barring a crash mid-run: occurrences are at least once).

## Durable message processing

`store.durability()` is core's durability backend (`BotConfig.durability`: journaled inbound, idempotent outbox, replay after a crash) on the same database file, table `durable`:

```ts
const store = new SQLiteStore({ file: './data/bot.db' })
const bot = new Bot({ provider, store, durability: { backend: store.durability() } })
```

Every write is one SQL statement conditioned on the stored version, so the compare-and-set is atomic even with several processes on the same file. `SQLiteDurableKv` (or `store.durability().kv`) is also the `DurableKv` the product packages (`@botmesh/inbox`, `@botmesh/crm`, `@botmesh/campaigns`, `@botmesh/deployments`, `@botmesh/hub`) persist to. Opt-in: nothing is created until you call it.

## Docker

Mount the directory that holds the database as a volume, next to the WhatsApp session:

```yaml
services:
  bot:
    build: .
    volumes:
      - ./sessions:/app/sessions   # WhatsApp auth (Baileys)
      - ./data:/app/data           # SQLite database
```

Back up `data/` together with `sessions/`.
