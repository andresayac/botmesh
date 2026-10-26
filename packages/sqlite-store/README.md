# @botmesh/sqlite-store

Persistent storage for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) in a single SQLite file, backed by [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). Message logs, chats, contacts, `.persistent()` flow checkpoints, `ctx.user` data, AI conversation history and delivery cursors survive restarts, with no database server to run.

- **One file, no setup.** The schema is created and migrated when the file is opened.
- **WAL** journal mode by default, for concurrent reads.
- The same database can also hold durable scheduled tasks (`store.schedules()`) and the durable inbox/outbox (`store.durability()`).
- Passes the same `IStore` conformance suite as every botmesh store.

Best fit: **one bot process** on a VPS or in a container. For several replicas sharing state, use [`@botmesh/redis-store`](https://www.npmjs.com/package/@botmesh/redis-store).

## Install

```bash
pnpm add @botmesh/sqlite-store better-sqlite3
```

> **Prerelease.** Until the stable release, botmesh packages are published under a prerelease dist-tag instead of `latest`: add it to the command (`pnpm add @botmesh/sqlite-store@alpha`, or `@beta` during the beta).

`better-sqlite3` is a peer dependency (`^11.7.0 || ^12.0.0 || ^13.0.0`, all three tested), a native module with prebuilt binaries for common platforms:

- **pnpm blocks its install script** (the step that fetches the binary) until you allow it. pnpm 11 stops the install with `ERR_PNPM_IGNORED_BUILDS`; pnpm 10 installs without the binary. Run `pnpm approve-builds` once, or allow it in `pnpm-workspace.yaml` and reinstall:

  ```yaml
  allowBuilds:
    better-sqlite3: true # pnpm 11; on pnpm 10: onlyBuiltDependencies: [better-sqlite3]
  ```

  Without the binary, the store throws `better-sqlite3 is installed but its native module was never built`.
- **Node.js 24.19 or later: use `better-sqlite3` 13.** Versions 11 and 12 can abort the process with `Assertion failed: (env) != nullptr` in `RemoveEnvironmentCleanupHook` when a prepared statement is garbage-collected, because of a Node.js regression ([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)). Version 13 is built on N-API and is not affected.
- **After a Node.js upgrade**, a binary built for the previous version gets its own error: run `pnpm rebuild better-sqlite3` (or `npm rebuild better-sqlite3`) with the Node.js that runs the bot.

## Quick start

```ts
import { Bot, flow } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'my-bot' }),
  store: new SQLiteStore({ file: './data/bot.db' }), // the ./data folder must exist
})

// With a durable store, a .persistent() flow resumes at the saved step after a restart
bot.use(flow('order').ask('What would you like?', 'item').say('Noted!').persistent())

await bot.start()
```

The bot calls the store's `start()` and `stop()` for you: `stop()` closes the database and `start()` reopens it, so one store instance survives `bot.stop()` / `bot.start()` cycles.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `file` | `string` | `'./bot.db'` | Path of the database file. Its folder must exist (SQLite creates the file, not folders). `':memory:'` keeps everything in memory. |
| `wal` | `boolean` | `true` | Use WAL journal mode. |
| `maxMessagesPerChat` | `number` | unbounded | Keep only the newest N messages per chat; older rows are pruned on each save. |
| `purgeBatchSize` | `number` | `1000` | Rows deleted per statement by `bot.purgeExpiredUserData()`. The purge yields to the event loop between batches. |
| `busyTimeoutMs` | `number` | `5000` | How long a statement waits for another connection's lock before `SQLITE_BUSY`. |
| `logger` | `Partial<LoggerLike>` | none | Receives close failures and schema migration notes (pino, `console` or the bot's logger). |

Invalid numbers throw a `RangeError` from the constructor.

## Errors you may see

| Error | Cause and fix |
| --- | --- |
| `better-sqlite3 is installed but its native module was never built` | pnpm skipped its build script. Allow it (see [Install](#install)) and reinstall. |
| `the better-sqlite3 native module was built for another Node.js version` | Run `pnpm rebuild better-sqlite3` (or `npm rebuild better-sqlite3`) with the Node.js that runs the bot. |
| `cannot open "./data/bot.db" because its directory does not exist` | Create the folder first (`mkdirSync(dirname(file), { recursive: true })`). SQLite creates the file, not its folders. |
| `code: 'SQLITE_NOTADB'` | `file` is not a SQLite database. |
| `SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`) | The file was written by a newer release of this package. It is left untouched; upgrade the package or restore a backup. |
| `TypeError` about a lone surrogate | A message id, chat id or cursor contains an unpaired UTF-16 surrogate, which SQLite would store as U+FFFD. |

## Schema versions and upgrades

The file records its layout in `PRAGMA user_version` (`SQLITE_SCHEMA_VERSION`, currently `2`). Opening it runs the pending migrations in order, each in its own transaction together with the version bump, so a failed step leaves the file at the last completed version and two processes never run a step twice. Existing rows are always kept.

Downgrades are not supported: **back up the file before upgrading** if you may need to roll back. A file written by a newer release is refused with `SQLiteSchemaVersionError`. Stop every process on the old version before the new one opens a shared file. The version 2 step only adds tables, so a version 2 file can be made readable by a release that writes version 1 with `PRAGMA user_version = 1` (with the `sqlite3` CLI, while nothing has the file open).

## Durable scheduled tasks and message processing

```ts
const store = new SQLiteStore({ file: './data/bot.db' })
const bot = new Bot({
  provider,
  store,
  scheduler: { store: store.schedules() },         // durable bot.schedule/every/delay tasks (registered with an id)
  durability: { backend: store.durability() },     // journaled inbound, idempotent outbox, replay after a crash
})

bot.schedule('0 9 * * *', { id: 'daily-report', missed: 'run-once' }, async (run) => {
  // run.occurrenceKey identifies this occurrence (runs are at least once)
})
```

Both live in the same file (tables `schedules`, `schedule_fences` and `durable`). Claims and writes are atomic transactions, so several processes sharing the file never run the same occurrence twice. `store.durability().kv` is also a `DurableKv` for your own durable records.

## Behaviour notes

- `upsertChat` / `upsertContact` **shallow-merge** over the existing record in one transaction, so concurrent partial upserts never drop each other's fields.
- `deleteChat(chatId)` removes the chat **and** its message log.
- `getMessagesByChat(chatId, limit)` returns the newest `limit` messages, oldest first (same windowing as the other stores).
- Message rows are keyed by `messageKey(ref)` (`{chatId}:{id}`, with `:` and `%` escaped), so ids containing `:` (such as Twilio's `whatsapp:+1…`) never collide. Rows written by older releases under the unescaped key are still found and moved on the next save.
- better-sqlite3 is synchronous: keep the database on a local disk, not a network share.

## Docker

Mount the folder that holds the database as a volume, next to the WhatsApp session if you use Baileys:

```yaml
services:
  bot:
    build: .
    volumes:
      - ./sessions:/app/sessions # WhatsApp auth (Baileys)
      - ./data:/app/data # SQLite database
```

Back up `data/` together with `sessions/`.

## Links

- [Persistent stores guide](https://andresayac.github.io/botmesh/guide/store) · [Scheduler](https://andresayac.github.io/botmesh/guide/scheduler) · [Durable processing](https://andresayac.github.io/botmesh/guide/durability) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/sqlite-store/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/sqlite-store) · [Issues](https://github.com/andresayac/botmesh/issues)
