# @botmesh/tickets

Support tickets and queues for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core): `ctx.tools.tickets` with states, priorities, queue positions, working hours, callbacks (`onAssign`, …) and persistence in the bot store.

- **Queue** ordered by priority (`urgent` > `high` > `normal` > `low`) and then age, with the customer's position.
- **Working hours** with time zones, split shifts and windows that cross midnight.
- **Chat messages** on create, assign and close, from templates.
- **Handoff wiring:** optionally hand the chat to a human when a ticket is assigned and resume the bot when it is closed.
- **Persistence** in any bundled store, and a **shared mode** with compare-and-set for several replicas.

## Install

```bash
pnpm add @botmesh/core @botmesh/tickets
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/tickets@beta` during the beta (`npm view @botmesh/tickets dist-tags` lists the tags). Once stable, the plain command above works.

## Quick start

```ts
import { ticketsPlugin } from '@botmesh/tickets'

bot.plug(ticketsPlugin({
  workingHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  timezone: 'America/Bogota',
  queueMessage: 'You are in the queue, position {{position}} (ticket #{{id}})',
  closedMessage: 'We are outside working hours; we will reply when we open (ticket #{{id}})',
  assignMessage: '{{assignee}} is handling your ticket #{{id}}',
  closeMessage: 'Ticket #{{id}} closed. Thank you!',
  handoffOnAssign: true,   // bot.handoff(chatId) on assign
  resumeOnClose: true,     // bot.resume(chatId) on close
  onAssign: async (ticket) => notifyAgent(ticket),
}))

bot.when('support', async (ctx) => {
  const ticket = await ctx.tools.tickets!.create({ chatId: ctx.from, subject: ctx.body, priority: 'normal' })
  await ctx.reply(`🎫 Ticket #${ticket.id} created`)
})

// Agent panel / your own API
const tickets = bot.injectTools.tickets!
await tickets.assign('1', 'ana')
await tickets.close('1', { reason: 'resolved' })
```

## Options

`ticketsPlugin(config)`:

| Option | Default | Description |
| --- | --- | --- |
| `workingHours` | always open | `'9-18'`, `'09:30-18:15'`, `{ days, start, end }`, an array of windows or `(date) => boolean` (see [Working hours](#working-hours)). |
| `timezone` | process time zone | IANA time zone used to evaluate `workingHours`. |
| `queueMessage` | — | Sent to the chat when a ticket is created inside working hours. |
| `closedMessage` | `queueMessage` | Sent instead when the ticket is created outside working hours. |
| `assignMessage` / `closeMessage` | — | Sent to the chat on assign / close. |
| `handoffOnAssign` | `false` | `bot.handoff(chatId)` when the ticket is assigned. |
| `resumeOnClose` | `false` | `bot.resume(chatId)` when the ticket is closed and the chat is handed off. |
| `reuseOpen` | `true` | `create()` returns the chat's unclosed ticket instead of opening another. |
| `storage` | bot store | Custom `{ get, set, setIf? }` persistence (see [Persistence](#persistence)). |
| `keyPrefix` | `'tickets:'` | Storage key prefix. |
| `now` | `Date.now` | Clock (epoch ms) used for timestamps and `withinWorkingHours`; handy in tests. |
| `maxRetries` | `20` | Shared mode only: compare-and-set attempts per write before `TicketContentionError`. |
| `onCreate` / `onAssign` / `onClose` / `onUpdate` | — | Callbacks, run after the change is persisted. |
| `onError` | `warn` log | Callback and notification errors. |

Templates accept `{{id}}`, `{{position}}`, `{{subject}}`, `{{priority}}`, `{{assignee}}`, `{{status}}` and `{{reason}}`; an unknown name renders as an empty string. Values are inserted as-is and never re-expanded, so a customer's subject that contains `{{id}}` stays literal.

## API (`ctx.tools.tickets`)

| Method | Description |
| --- | --- |
| `create({ chatId, subject, priority?, meta? })` | Creates an `open` ticket. Returns the ticket plus `created`, `position` (1-based or `null`) and `withinWorkingHours`. With `reuseOpen` it returns the chat's unclosed ticket when one exists (`created: false`). |
| `get(id)` | Ticket or `undefined`. |
| `update(id, patch)` | `subject`, `priority`, `status`, `assignee` (`null` unassigns and returns it to the queue), `meta`. Rejects with `TicketNotFoundError`. |
| `list(filter?)` | Filters by `status` (one or several), `chatId`, `assignee`, `priority`; ordered by age. |
| `assign(id, assignee)` | `assigned` state; fires `onAssign`. |
| `close(id, { reason? })` | `closed` state, `closedAt`, `closeReason`; fires `onClose`. |
| `queue()` | `open` tickets by priority and then age. |
| `position(id)` | Queue position or `null`. |
| `isOpen(date?)` | Whether it is within working hours (always `true` without `workingHours`). |

States: `open` (queued), `assigned`, `pending` (waiting for the customer, out of the queue) and `closed`. Ids are sequential (`'1'`, `'2'`, …) per bot namespace. `TICKET_STATUSES` and `TICKET_PRIORITIES` list them (frozen).

`meta` must be a plain JSON object (no `Date`, `Map`, class instances, functions or `BigInt`); `create` and `update` reject anything else with a `TypeError` before writing. A stored value that is not valid JSON makes the call reject with an error that names the storage key.

`TicketDesk` works without a bot: `new TicketDesk({ storage: memoryTicketStorage() })`.

## Working hours

`workingHours` accepts `'9-18'`, `'09:30-18:15'`, `{ days, start, end }` (days `0` = Sunday … `6` = Saturday), an array of windows (split shifts) or a function `(date) => boolean`. The end is exclusive (`24`/`'24:00'` is allowed as an end, never as a start) and a window such as `'22-6'` crosses midnight. It is evaluated in `timezone`. Outside working hours `closedMessage` is sent instead of `queueMessage`. `parseWorkingHours()` and `isWithinWorkingHours()` are exported for your own checks.

## Persistence

By default it uses the bot store's cursor API (`tickets:seq`, `tickets:index`, `tickets:t:<id>`), which all six bundled stores implement; with `MemoryStore` it lives in RAM. `tickets:index` lists only unclosed tickets: only active ones live in memory, and closed ones are read on demand (`get`, and `list` when the filter may include `closed`, which scans every id). It loads lazily on the first call (`install` is synchronous) and mutations are serialized; if a store write fails, the call rejects and memory does not change.

The default storage has no compare-and-set, so it is for **one process** per store namespace: two replicas over it would hand out the same id. For replicas, pass a storage with `setIf`, such as `durableKvTicketStorage(kv)` over a shared `DurableKv`, or your own. The desk then re-reads the index on every call, claims ids with a compare-and-set and retries a lost write (`maxRetries`, then `TicketContentionError`). With `reuseOpen` it also claims the chat's open ticket with a compare-and-set (`open:<chatId>`), so replicas creating for the same chat at once share one ticket, and a failed create never leaves an open ticket outside the index.

## Callbacks and messages

`onCreate`, `onAssign`, `onClose` and `onUpdate(ticket, previous)` run after the change is persisted and outside the desk's lock (they may call back into it); their errors, and send errors, go to `onError` and never make the operation fail.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `tickets: the store has no cursor support; tickets live in memory only` | The store has no `getCursor`/`setCursor`. Every bundled store has them; a custom store needs them, or pass `storage`. |
| Two tickets with the same id across replicas | The default storage is for one process. Use `durableKvTicketStorage(kv)` (or a storage with `setIf`) on every replica. |
| `TicketContentionError` | Many replicas write the same desk at once; raise `maxRetries` or route ticket writes through fewer processes. |
| `closedMessage` is sent during office hours | `timezone` is not set and the server runs in another time zone (UTC on most hosts). |
| The bot stays silent after the ticket is unassigned | Unassigning (`assignee: null`) keeps the handoff: only `close()` resumes (with `resumeOnClose`). Call `bot.resume(chatId)` yourself if the bot should answer while the ticket waits in the queue. |
| `getHandoff(chatId).meta.assignee` shows the first agent | The handoff is taken on the first assignment and a reassignment does not change it; read the ticket's `assignee`. |
| The bot keeps answering after `assign()` | `handoffOnAssign` is off (the default): turn it on, or call `bot.handoff()` yourself. |
| `list({ status: 'closed' })` is slow | Closed tickets are read one by one from storage. Archive them in your own database from `onClose` if you need fast history queries. |

## Links

- [Integrations guide (tickets)](https://andresayac.github.io/botmesh/guide/integrations#tickets) · [Human handoff](https://andresayac.github.io/botmesh/guide/handoff) · [Persistent stores](https://andresayac.github.io/botmesh/guide/store) · [Replicas](https://andresayac.github.io/botmesh/guide/replicas)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/tickets/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/tickets) · [Issues](https://github.com/andresayac/botmesh/issues)
