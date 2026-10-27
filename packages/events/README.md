# @botmesh/events

Primitives to process asynchronous work reliably: versioned event envelopes, leased journals with fencing tokens, an at-least-once `EventWorker` with retries and backoff, and a dead-letter state. The main entry has no dependencies (not even `@botmesh/core`); [`@botmesh/events/durability`](#bot-durability-backend) turns a journal into the durability backend of a [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) bot.

## Install

```bash
pnpm add @botmesh/events
```

Node.js 22 or later, ESM only. `@botmesh/core` is an optional peer dependency, needed only by `@botmesh/events/durability` (a bot already has it).

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

## Quick start

```ts
import { createEnvelope, EventWorker, FileEventJournal } from '@botmesh/events'

const journal = await FileEventJournal.open('./data/events.json')
await journal.append(createEnvelope({
  eventType: 'order.created',
  context: { tenantId: 'acme', environmentId: 'production', botId: 'support', providerId: 'meta', connectionId: 'main', chatId: '573001234567' },
  payload: { orderId: 'A-17' },
}))

const worker = new EventWorker(journal, { maxAttempts: 5, leaseMs: 30_000 })
worker.on('order.created', async (event) => {
  await notifyKitchen(event.payload) // make it idempotent: use event.idempotencyKey
})

const { processed, failed, stale } = await worker.runBatch()
```

`runBatch(limit?)` claims up to `limit` due events (100 by default), runs their handlers and acknowledges them. A handler that throws schedules a retry with exponential backoff; after `maxAttempts` the event moves to the `dead` state (the dead-letter queue), where `list()` shows it and `replay()` puts it back. Call `runBatch()` from a timer or a scheduled task (`bot.every('5s', ...)`).

## Journals

| Journal | For | Notes |
| --- | --- | --- |
| `MemoryEventJournal` | tests, development | Lost on restart. |
| `FileEventJournal.open(path, { lock?, fsync? })` | one process | Recovers its snapshot after a restart and writes with atomic replacement. `lock: true` adds an advisory `<file>.lock` so a second process cannot open the same file (a dead process's lock is taken over; nothing is ever killed). |
| `SharedFileEventJournal.open(path, { lockTimeoutMs?, staleLockMs?, heartbeatMs?, appendLog?, fsync? })` | several processes on one host | Every write takes a cross-process mutex, re-reads the file, applies the change and replaces it atomically, so claims are exclusive and fencing tokens hold across processes. `appendLog` appends a delta per write and compacts every 1000 entries or 4 MiB. |

The file journals store JSON: an envelope JSON cannot hold (a `BigInt`, a circular reference) is rejected with a `TypeError` and nothing is stored, and what you read back is the JSON form (a `Date` comes back as its ISO string). Every journal checks the record before it stores it, with the same rules the file reader applies: an envelope with a missing `eventId`, `eventType`, `idempotencyKey` or `partitionKey`, an `occurredAt` that is not a finite number (`NaN`, a `Date`), a non-object `context`, or a `toJSON` that changes those fields is rejected with a `TypeError`, so nothing a journal accepts can stop it from reopening. `createEnvelope` rejects a non-finite `occurredAt` too. A damaged snapshot or append log is refused on open, or on the operation that reads it, with an error naming the file and the bad record; that includes a record whose lease fields (`leaseUntil`, `fencingToken`, `owner`, `channel`) are damaged, which would otherwise never be claimed again.

The file journals rewrite the whole snapshot on each write (the append-log mode excepted), and every `SharedFileEventJournal` operation (reads too) takes the cross-process mutex and re-reads the file: expect a few milliseconds per operation on Linux and tens on Windows, and several operations per bot message when it backs `eventsDurability`. For high traffic, implement `LeasedEventJournal` over your database. A custom journal must check the fencing token in the same atomic operation that changes the state (for example `UPDATE ... WHERE fencing_token = $1 AND state = 'processing'`).

### Leases and fencing tokens

Each claim returns a strictly increasing `fencingToken` per event (never reused, not even after `replay`). `EventWorker` passes it to `ack`/`fail`, and the journal rejects a superseded token with `StaleLeaseError`. If a worker's lease expires while its handler is still running and another worker claims the event, the first one can no longer mark it done, retry it or dead-letter it: `runBatch()` counts it as `stale`. A record whose lease expired before its handler started is skipped and released without consuming the attempt.

Delivery is **at least once**: a handler may run twice, so make it idempotent with `envelope.idempotencyKey`. Calling `ack`/`fail` without a `fencingToken` is an operator override with no check.

## Worker options

| Option | Default | What it does |
| --- | --- | --- |
| `maxAttempts` | `5` | Attempts before an event goes to the dead-letter state. |
| `retryDelayMs` | `exponentialBackoff` (1 s doubling, capped at 60 s) | Fixed delay between attempts. |
| `leaseMs` | the journal's (30 s) | Lease requested on each claim. |
| `clock` | `Date.now` | Time source (inject it in tests). |

An invalid value (`maxAttempts: 0`, a negative or `NaN` delay, a zero lease) throws a `TypeError` in the constructor. The journals check their own time and duration arguments the same way before they change anything, so a bad value can never strand a record with a `NaN` lease or due time.

## Bot durability backend

An app that already keeps a journal can use it as the bot's durable inbox and outbox ([`BotConfig.durability`](https://andresayac.github.io/botmesh/guide/durability)), without another store:

```ts
import { Bot } from '@botmesh/core'
import { FileEventJournal } from '@botmesh/events'
import { eventsDurability } from '@botmesh/events/durability'

const journal = await FileEventJournal.open('./data/events.json', { lock: true })
const bot = new Bot({ provider, durability: { backend: eventsDurability({ journal }) } })
// …
await bot.stop()
await journal.close()
```

- **Inbox:** each inbound message is an `EventRecord` of the journal (`eventType: 'botwa.inbound.message'`, channel `'botwa:durable'`, permanent names kept from the project's former name). `list()` and `replay()` see them; an `EventWorker` never claims them, because a claim without `channel` only takes records without one. The bot processes those records itself (FIFO per chat, causation, ack on settle).
- **Outbox:** the core outbox over a key-value store kept as a *sidecar* of the same journal (same file, same atomic snapshot), or over a `DurableKv` you pass as `outbox` (a Postgres or Redis one when several processes share another journal).
- `FileEventJournal` needs `{ lock: true }` here. Several replicas on one host share a `SharedFileEventJournal`.

| Option | Default | What it does |
| --- | --- | --- |
| `journal` | required | A `LeasedEventJournal` (the three bundled journals are). |
| `outbox` | sidecar of `journal` | A shared `DurableKv` for the outbox. |
| `context` | `'botwa'` placeholders | Envelope context written on the bot's records. |
| `channel` | `'botwa:durable'` | Isolation channel of the bot's records. |
| `exclusive` | `journal.exclusive` | Only one process uses this storage at a time. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `StaleLeaseError` in logs, events counted as `stale` | A handler outlived its lease and another worker took the event. Raise `leaseMs` or shorten the handler. |
| Events pile up in `dead` | The handler keeps throwing. Fix it, then `replay()` them. |
| `FileEventJournal` refuses to open: locked | Another live process holds `<file>.lock`. Use `SharedFileEventJournal` for several processes. |
| `APPEND_LOG_CORRUPT` when opening | A line in the middle of `<file>.log` is damaged. Restore from a backup, or cut the log at the reported line to keep the entries before it. |
| `Cannot find package '@botmesh/core'` from `/durability` | Install `@botmesh/core`: the durability backend plugs into a bot. |

## Links

- [Operations guide: event processing](https://andresayac.github.io/botmesh/guide/operations#event-processing) · [Durable message processing](https://andresayac.github.io/botmesh/guide/durability)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/events/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/events) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver.
