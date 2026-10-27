# @botmesh/mongo-store

Shared, persistent storage for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) on MongoDB, through the official [`mongodb`](https://www.npmjs.com/package/mongodb) driver. Point any number of bot replicas at the same deployment and they share message logs, chats, contacts, `.persistent()` flow checkpoints, `ctx.user` data, AI conversation history and delivery cursors.

- **Durable scheduled tasks** (`store.schedules()`, a `MongoScheduleStore`): single-document atomic commands, so a standalone `mongod` works.
- Compare-and-set checkpoints (`setCheckpointIf`), used by `BotConfig.coordination`.
- A replica set, a sharded cluster (`mongos`), a standalone server or Atlas. Indexes are created on `start()`.
- Ids that enter a filter must be strings, so untrusted input such as `{ "$ne": "" }` can never become a query operator. The package passes the same `IStore` conformance suite as every botmesh store.

There is no MongoDB durability backend (`BotConfig.durability`); use `@botmesh/postgres-store`, `@botmesh/redis-store` or `@botmesh/sqlite-store` for that.

## Install

```bash
pnpm add @botmesh/mongo-store mongodb
```

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

`mongodb` is a **peer dependency** (`^6.10` or `^7`, both tested), loaded only when the store creates its own client. You need a MongoDB server reachable from the bot (for example `mongodb://localhost:27017`).

## Quick start

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { MongoStore } from '@botmesh/mongo-store'

const store = new MongoStore({
  url: process.env.MONGO_URL, // default: mongodb://localhost:27017
  dbName: 'mybot', // default: 'botwa'
  collectionPrefix: 'prod_', // default: ''
})

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }), store })
await bot.start() // starts the store too: builds and connects the client, creates the indexes
```

Using the store before it is started, or after `stop()`, fails with an error that tells you to call `start()`. `stop()` closes the client only when the store created it; a later `start()` opens it again.

### Bring your own client

Pass an existing (usually connected) `MongoClient`: the store then never connects or closes it.

```ts
import { MongoClient } from 'mongodb'

const client = new MongoClient(process.env.MONGO_URL!)
await client.connect()
const store = new MongoStore({ client, dbName: 'mybot' })
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | `'mongodb://localhost:27017'` | Connection URL. Ignored when `client` is given. |
| `dbName` | `string` | `'botwa'` | Database holding the collections. Must be a valid, non-empty MongoDB database name. |
| `collectionPrefix` | `string` | `''` | Prefix for every collection, so several bots share one database. No `$` or NUL, and not starting with `system.`. |
| `client` | `MongoLikeClient \| NativeMongoClient` | none | An existing client. The store never connects or closes it; `start()` still creates the indexes. |
| `maxMessagesPerChat` | `number` | unbounded | Keep only the newest N messages per chat; older documents are pruned on each save. |
| `purgeBatchSize` | `number` | `1000` | Documents deleted per `deleteMany` by `bot.purgeExpiredUserData()`; the purge loops until nothing expired is left. |
| `logger` | `Partial<LoggerLike>` | none | Receives client close failures (pino, `console` or the bot's logger). |

An invalid `dbName` or `collectionPrefix` throws an `Error` and invalid numbers a `RangeError` from the constructor.

## Durable scheduled tasks

```ts
const store = new MongoStore({ url: process.env.MONGO_URL, dbName: 'mybot' })
const bot = new Bot({ provider, store, scheduler: { store: store.schedules() } })

bot.schedule('0 9 * * 1-5', { id: 'daily-report', timeZone: 'America/Mexico_City' }, async (run) => {
  // run.occurrenceKey identifies this occurrence (runs are at least once)
})
```

- Collection `{collectionPrefix}schedules`. Every operation is one atomic single-document command (`insertOne`, `findOneAndUpdate`, `updateOne`): a claim is a conditional `findOneAndUpdate` with `$inc` on the fencing token, so concurrent claimers get exactly one winner, with no transactions.
- `delete()` (`task.cancel()`, `bot.forgetTask(id)`) is a soft delete that keeps the id's fencing token; purge old tombstones by hand only when no runner can still hold their token (`deleteMany({ deleted: true, updatedAt: { $lt: <epoch ms a day ago> } })`).
- A token past int32 is promoted to a 64-bit integer by the server and read back as a `number`. Leases use the caller's clock, so keep replicas in sync (NTP). A standalone `new MongoScheduleStore({ collection })` takes any driver `Collection` and never closes its client.

## Collection layout

| Collection | `_id` | Document |
| --- | --- | --- |
| `messages` | `messageKey(ref)` | `{ chatId, timestamp, msg: StoredMessage }`, indexed by `{ chatId: 1, timestamp: 1, _id: 1 }` |
| `chats` | chat id | the `StoredChat` |
| `contacts` | contact id | the `StoredContact` |
| `checkpoints` | key | `{ cp: FlowCheckpoint }` |
| `conversations` | key | `{ messages: AIMessage[] }` (`@botmesh/ai` history) |
| `cursors` | key | `{ value }`: delivery cursors (e.g. Telegram `update_id`), `WELCOME` markers, handoff index |
| `user_data` | user id + namespace + key | `ctx.user` entries (exact JSON text, optional expiry, indexed) |
| `schedules` | task id | durable scheduler tasks (`store.schedules()`) |

Every name gets the `collectionPrefix`. Databases created by an early version also keep a `chatId_1_timestamp_1` index that is no longer used; drop it with `db.messages.dropIndex('chatId_1_timestamp_1')`.

## Errors you may see

| Error | Cause and fix |
| --- | --- |
| `needs the MongoDB driver "mongodb", which is not installed` | Install the peer dependency (`pnpm add mongodb`), or pass your own `client`. |
| `MongoStore is not started — call start() before using it` | The bot starts the store; if you use it on its own, `await store.start()` first. |
| `MongoStore is stopped — call start() before using it` | The store (or the bot) was stopped and closed its own client. Call `start()` again, or stop the store only after the last call. |
| Every call hangs for up to a minute while the server is unreachable | The driver's default timeouts. Add a client-side timeout to the URL, for example `mongodb://host:27017/?timeoutMS=5000` (or `socketTimeoutMS` / `serverSelectionTimeoutMS`), so a call fails fast and the chat's queue moves on. |
| `TypeError` naming an id | An id that enters a filter (chat, message, contact, key, `ctx.user` user/namespace/key, schedule id) is not a string. Never pass request bodies through unchecked. |
| `invalid dbName` / `invalid collectionPrefix` | Use a valid MongoDB name (see [Options](#options)). |
| Server selection timeout on Windows with Docker | Use `127.0.0.1` instead of `localhost`: `localhost` resolves to `::1` first and the driver times out. For a single-node replica set reached through a port forward, add `directConnection=true` to the URL. |

## Behaviour notes

- `deleteChat(chatId)` removes the chat **and** its message log. On a replica set or `mongos` both deletes run in one transaction; a standalone server cannot run transactions, so there the store deletes the messages first and then the chat (a retry finishes an interrupted delete). Both driver majors' way of reporting a standalone server are recognised.
- `upsertChat` / `upsertContact` shallow-merge in one `updateOne`: fields you pass replace the stored ones, omitted fields are kept and a field passed explicitly as `undefined` is removed.
- `getMessagesByChat(chatId, limit)` returns the newest `limit` messages, oldest first, sorted by `timestamp` then `_id`, so messages with the same timestamp always give the same window and the `maxMessagesPerChat` trim keeps exactly those.
- BSON: `undefined` is never stored as `null` (nested `undefined` values are dropped), binary data in `raw` or checkpoint state reads back as a Node `Buffer`, and an object key holding U+0000 is stored with U+FFFD. Keys such as `constructor` or `toString` round-trip like any other key (the store works around a js-bson quirk that returned their arrays of objects as raw bytes). Every document is limited to MongoDB's 16 MB.
- Message documents are keyed by `messageKey(ref)` (`{chatId}:{id}`, with `:` and `%` escaped), so ids containing `:` (such as Twilio's `whatsapp:+1…`) never collide. Documents written by older releases under the unescaped key are still found and moved on the next save.

## Development

The unit tests run against an in-memory fake client, with no network. Opt-in suites (`BOTWA_TEST_MONGO_URL`) run the shared `IStore`, `ctx.user` and `ScheduleStore` conformance suites and concurrency checks against a real server, standalone or replica set; `BOTWA_TEST_MONGO_DRIVER=v6` runs every suite with the 6.x driver instead of 7.x. See [CONTRIBUTING](https://github.com/andresayac/botmesh/blob/main/CONTRIBUTING.md#store-integration-tests-docker) for the Docker commands.

## Links

- [Persistent stores guide](https://botmesh.afaya.com.co/guide/store) · [Scheduler](https://botmesh.afaya.com.co/guide/scheduler) · [Running N replicas](https://botmesh.afaya.com.co/guide/replicas) · [Troubleshooting](https://botmesh.afaya.com.co/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/mongo-store/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/mongo-store) · [Issues](https://github.com/andresayac/botmesh/issues)
