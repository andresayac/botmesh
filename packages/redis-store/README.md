# @botmesh/redis-store

Shared, persistent storage for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) on Redis. Point any number of bot replicas at the same Redis and they share message logs, chats, contacts, `.persistent()` flow checkpoints, `ctx.user` data, AI conversation history and delivery cursors.

It also carries the pieces you need to run **several replicas of one bot**:

- **`RedisCoordinator`** (`BotConfig.coordination`): each chat is processed by one replica at a time, in arrival order, and exclusive transports such as Baileys connect on one elected replica only.
- **Durable scheduled tasks** (`store.schedules()`, `store.leases()`) and the **durable inbox/outbox** (`RedisDurability`).
- **Fenced locks** (`acquireLockFenced` / `renewLock` / `releaseLock`) for your own critical sections.
- **Redis Cluster** support (opt-in): pass a cluster client and every component switches to a hash-tagged key layout.

## Install

```bash
pnpm add @botmesh/redis-store redis
```

> **Prerelease.** Until the stable release, botmesh packages are published under a prerelease dist-tag instead of `latest`: add it to the command (`pnpm add @botmesh/redis-store@alpha`, or `@beta` during the beta).

You need a Redis server reachable from the bot (for example `redis://localhost:6379`). [`redis`](https://github.com/redis/node-redis) (node-redis) is a **peer dependency**: `^4.7`, `^5` or `^6`. Every component works with each of them, on a single node or a Redis Cluster, with RESP2 or RESP3.

## Quick start

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { RedisStore } from '@botmesh/redis-store'

const store = new RedisStore({
  url: process.env.REDIS_URL, // default: redis://localhost:6379
  prefix: 'mybot', // default: 'botwa'
  sessionTtl: '7d', // optional: expire conversations and checkpoints after 7 days
})

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }), store })
await bot.start() // connects the store's client too
```

Using the store before it is started (or after it is stopped) fails with an error that tells you to call `start()`.

### Bring your own client

Pass an existing (usually already connected) client: the store then never connects or closes it.

```ts
import { createClient } from 'redis'

const client = createClient({ url: process.env.REDIS_URL })
client.on('error', (err) => console.error('redis client error', err)) // required, see below
await client.connect()

const store = new RedisStore({ client })
```

node-redis **re-throws an `'error'` event that has no listener**, so an injected client without one crashes the process on the first dropped connection. The store adds that listener only to the clients it creates itself. Do not inject a client created with `returnBuffers: true`: the store expects string replies.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | `redis://localhost:6379` | Connection URL. Ignored when `client` is given. |
| `prefix` | `string` | `'botwa'` | Namespace of every key, so several bots can share one database. The default predates the botmesh name and stays (existing data lives under it). |
| `client` | node-redis client or cluster client | none | Use an existing client; the store never connects or quits it. A cluster client selects the `'cluster'` layout. |
| `cluster` | `{ rootNodes, nodeAddressMap?, defaults?, maxCommandRedirections? }` | none | Create (and own) a node-redis cluster client. Not combinable with `url`/`client`. |
| `layout` | `'legacy' \| 'cluster'` | `'cluster'` on a cluster, else `'legacy'` | Key layout (see [Redis Cluster](#redis-cluster)). `'legacy'` on a cluster throws. |
| `allowLegacyData` | `boolean` | `false` | Cluster layout on a single node: start even when legacy-layout keys exist under the prefix. |
| `sessionTtl` | `string \| number` | none | TTL of AI conversations and flow checkpoints: a duration (`'24h'`, `'7d'`) or milliseconds. Messages, chats, contacts and cursors never expire. |
| `maxMessagesPerChat` | `number` | unbounded | Keep only the newest N messages per chat. Safe with several replicas writing the same chat. |
| `logger` | `{ error? }` | none | Receives the errors of a store-created client (connection drops, reconnects) and lifecycle errors. |

Invalid values throw from the constructor.

## Running several replicas

```ts
const store = new RedisStore({ url: process.env.REDIS_URL, prefix: 'mybot' })
const bot = new Bot({
  provider,
  store,
  coordination: { coordinator: store.coordinator({ leaseMs: '15s' }) },
})
```

- **Chat turns.** Each inbound message reserves a ticket in its chat's queue; the replicas process a chat one message at a time, in arrival order. Tickets of a replica whose heartbeat expired are skipped.
- **Leadership.** An exclusive transport (Baileys, Discord, Telegram long polling) connects only on the elected replica. Each change of leader increments a term that acts as a fencing token.
- **Watchdog.** Leases are renewed every `leaseMs / 3`. A lease found gone is aborted; with no successful renewal for 90% of `leaseMs`, every lease is given up locally before Redis can hand it to another replica.
- **Limits.** A Sentinel or Cluster failover that loses the last writes can grant a lease twice. Keep the replicas' clocks in sync (NTP).

`new RedisCoordinator({ url, prefix })` builds one without a store. Guide: [Running N replicas](https://andresayac.github.io/botmesh/guide/replicas).

## Durable scheduled tasks and message processing

```ts
import { RedisDurability, RedisStore } from '@botmesh/redis-store'

const store = new RedisStore({ url: process.env.REDIS_URL })
const bot = new Bot({
  provider,
  store,
  scheduler: { store: store.schedules(), lease: store.leases() }, // tasks registered with an id survive restarts
  durability: { backend: new RedisDurability({ url: process.env.REDIS_URL }) }, // journaled inbound, idempotent outbox
})

bot.every('15m', { id: 'sync-crm', missed: 'run-once' }, async (run) => {
  // run.occurrenceKey identifies this occurrence (runs are at least once)
})
```

Every claim is an atomic compare-and-set, so of N replicas claiming one occurrence exactly one wins, with a fencing token that only grows. `RedisScheduleStore`, `RedisLeaseProvider` and `RedisDurableKv` can also be built on any client.

## Distributed lock

```ts
const lock = await store.acquireLockFenced(`report:${day}`, 30_000)
if (!lock) return // another replica holds it

try {
  await writeReport(day, { fence: lock.fence }) // the resource rejects fences lower than the last it saw
  await store.renewLock(`report:${day}`, lock.token, 30_000) // extend a long section
} finally {
  await store.releaseLock(`report:${day}`, lock.token)
}
```

- `acquireLockFenced(key, ttlMs = 30_000)` resolves to `{ token, fence }`, or `null` when the lock is held. `fence` grows by one on every acquisition and never resets.
- `renewLock(key, token, ttlMs)` is `true` while `token` still owns the lock, `false` once it expired or changed hands.
- `releaseLock(key, token)` deletes the lock only if `token` still owns it, so a slow holder never deletes a newer owner's lock.
- `ttlMs` must be a positive number; the deadline guarantees a crashed holder never blocks the others.

## Redis Cluster

Pass a node-redis cluster client (or the `cluster` option) and the store, `coordinator()`, `schedules()`, `leases()` and `RedisDurability` use the **cluster key layout**. A store without it keeps the legacy layout unchanged.

```ts
import { createCluster } from 'redis'

const cluster = createCluster({ rootNodes: [{ url: 'redis://redis-0:6379' }] })
cluster.on('error', (err) => console.error('redis cluster', err))
await cluster.connect()

const store = new RedisStore({ client: cluster, prefix: 'mybot' }) // store.layout === 'cluster'
// or let the store create (and own) the cluster client:
// new RedisStore({ cluster: { rootNodes: ['redis://redis-0:6379'] }, prefix: 'mybot' })
```

- Every script declares all its keys, and they share one hash slot. Listings read bucket indexes, never `KEYS`/`SCAN`. `TRYAGAIN`/`CLUSTERDOWN` and unfollowed redirects are retried with backoff.
- **Migrating existing data** (offline): `migrateToClusterLayout({ source, target?, prefix, dryRun?, deleteSource? })` copies a legacy keyspace into the cluster layout (resumable, TTLs kept, fencing tokens only grow). `inspectKeyspace({ client, prefix })` counts keys per layout. Roll back with `direction: 'cluster-to-legacy'`.
- A cluster-layout store on a single node refuses to start over legacy data unless `allowLegacyData: true`; switch every replica at once.
- Key-builder internals are in `@botmesh/redis-store/internal`, with **no semver guarantee** (for tooling that inspects a keyspace).

Guide, with the full key table and migration steps: [Redis Cluster](https://andresayac.github.io/botmesh/guide/redis-cluster).

## Key scheme (legacy layout)

| Key | Type | Contents | TTL |
| --- | --- | --- | --- |
| `{prefix}:msg:{chatId}` | sorted set | `messageKey(ref)` scored by timestamp (per-chat index) | none |
| `{prefix}:msg:item:{messageKey}` | string (JSON) | `StoredMessage` | none |
| `{prefix}:chat:{id}` | string (JSON) | `StoredChat` | none |
| `{prefix}:contact:{id}` | string (JSON) | `StoredContact` | none |
| `{prefix}:cp:{key}` | string (JSON) | `FlowCheckpoint` | `sessionTtl` |
| `{prefix}:conv:{key}` | string (JSON) | AI history (`AIMessage[]`) | `sessionTtl` |
| `{prefix}:cursor:{key}` | string | delivery cursor (e.g. Telegram `update_id`) | none |
| `{prefix}:lock:{key}` | string | lock token | lock `ttlMs` |
| `{prefix}:sched:{id}` | string (JSON) | durable scheduled task | none |
| `{prefix}:lease:{key}` | string (JSON) | fenced lease (owner, deadline, token) | none |
| `{prefix}:co:…` | various | coordinator turns, heartbeats and leaderships | idle chats expire after 1 day |

The legacy layout targets a single Redis node (or Sentinel); use the cluster layout on Redis Cluster.

## Behaviour notes

- `getMessagesByChat(chatId, limit)` returns the newest `limit` messages, oldest first, with one `ZRANGE` (no scans).
- `deleteChat(chatId)` removes the chat and its whole message log in one Lua script, so a message saved at the same moment never becomes an orphan.
- `upsertChat` / `upsertContact` shallow-merge over the existing record with a server-side compare-and-set, so concurrent upserts from any number of replicas never lose each other's fields. Values are stored byte-exact.
- Listings in the legacy layout use incremental `SCAN`, never one blocking `KEYS`; glob characters in the prefix are escaped.
- A store-created client reconnects with backoff after a dropped connection instead of crashing; `start()` rejects promptly (e.g. `ECONNREFUSED`) when the server is unreachable and can be called again; `stop()` never hangs (it gives up on `QUIT` after 2 s).

## Development

The unit tests run against an in-memory fake client, with no network. Opt-in suites run against a real Redis (`BOTWA_TEST_REDIS_URL`) and a real Redis Cluster (`BOTWA_TEST_REDIS_CLUSTER_URL`); see [CONTRIBUTING](https://github.com/andresayac/botmesh/blob/main/CONTRIBUTING.md) for the Docker commands.

## Links

- [Persistent stores guide](https://andresayac.github.io/botmesh/guide/store) · [Running N replicas](https://andresayac.github.io/botmesh/guide/replicas) · [Durable processing](https://andresayac.github.io/botmesh/guide/durability) · [Redis Cluster](https://andresayac.github.io/botmesh/guide/redis-cluster) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/redis-store/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/redis-store) · [Issues](https://github.com/andresayac/botmesh/issues)
