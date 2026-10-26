# Migrating to 2.0

`@botmesh/core` 2.0 leaves the alpha series with a few deliberate behaviour
changes. This page lists each one, what changed and how to keep the old
behaviour where that is still possible. Most bots need at most two edits:
`lang: 'es'` if the bot speaks Spanish, and `maxAttempts` where a wait set
`retries`.

| Change | Who is affected | What to do |
| --- | --- | --- |
| [Built-in texts default to English](#built-in-texts-default-to-english) | Bots that relied on the Spanish defaults | Add `lang: 'es'` |
| [`retries` and `maxAttempts`](#retries-and-maxattempts) | Waits, forms and JSON flows that set `retries` | Rename `retries: N` to `maxAttempts: N` |
| [Sends need a running bot](#sends-need-a-running-bot) | Code that sends before `start()` or after `stop()` | Send after `start()`, or catch `BotNotRunningError` |
| [Flow definitions are checked when built](#flow-definitions-are-checked-when-built) | `choose({})`, `ask(text, '')` | Fix the definition |
| [Rate-limited `ctx` sends retry once](#rate-limited-ctx-sends-retry-once) | Bots on transports that answer 429 | Nothing, or tune `rateLimitRetry` |
| [Invalid provider events](#invalid-provider-events) | Custom providers | Emit well-formed events |
| [A hook that calls `next()` twice](#a-hook-that-calls-next-twice) | Hooks with that bug | Call `next()` once |
| [Ids in logs are hashed](#ids-in-logs-are-hashed) | Log searches by phone number or chat id | `logIds: 'raw'` for local debugging |
| [Corrupt append logs](#corrupt-append-logs) | `FileDurability` / `SharedFileEventJournal` with `appendLog` | Repair the log if open refuses it |
| [`MemoryCoordinationHub` evicts idle chats](#memorycoordinationhub-evicts-idle-chats) | Tests that inspect the hub | Nothing |
| [`broadcast({ maxRetries })`](#broadcast-retries) | Broadcasts | Rename to `retries` (alias kept) |
| [WhatsApp Flow labels default to English](#whatsapp-flow-labels-default-to-english) | `@botmesh/meta` forms published with `toFlowJson` / `publishForm` | Pass `lang: 'es'` |

## Built-in texts default to English

The texts the core writes for you (conversation timeout, "too many attempts",
wait prompts, slash-command replies, form hints and the form skip word) used
to be Spanish unless the bot configured i18n. They are now English: the skip
word is `skip`, the retries message is `❌ Too many attempts. Conversation
ended.`, and so on. `@botmesh/ai` follows: its built-in texts (confirmation
prompt, Yes/No buttons, fallback replies, sources line) are English when no
language is known.

The Spanish texts are still bundled. One option brings them back, without
turning on per-user language resolution:

```ts
const bot = new Bot({ provider, lang: 'es' })
```

`i18n: { defaultLocale: 'es' }` also works, but it turns on language
resolution (stored preference, client language, detector). See
[Internationalization](./i18n#a-single-language-bot-lang). The project
templates of `create-botmesh` already set `lang: 'es'`.

## `retries` and `maxAttempts`

Every `retries` option now means the same thing: attempts **after** the
first one. That was already the case for `durability.outbox.retries`, but
on waits (`ask`, `waitText`, `choose`…), form steps and JSON flow `ask`/`form`
steps `retries: N` meant N answers in total. The total has its own option:

- `maxAttempts: N`: the wait accepts N answers in total, the first included.
- `retries: N`: the same as `maxAttempts: N + 1`.

The default does not change (3 answers in total). To keep the alpha behaviour,
rename the option:

```ts
// 2.0 alpha: 3 answers in total
flow('x').ask('Email?', 'email', { validate, retries: 3 })
// 2.0: the same
flow('x').ask('Email?', 'email', { validate, maxAttempts: 3 })
```

Passing both with values that disagree throws a `TypeError`. Invalid values
(`maxAttempts: 0`, `retries: -1`) throw when the flow is defined.
`bot.broadcast()` follows the same convention (see [below](#broadcast-retries)).

Code you have not renamed yet keeps running with one more answer than before.
To make that visible, the bot logs **one warning** (`logger.warn`, once per bot)
the first time a wait, form or flow step sets `retries` without `maxAttempts`.
Setting `maxAttempts` (alone, or together with a matching `retries`) silences it.

JSON flow documents (`@botmesh/flow-schema`, stored by the manager and
`@botmesh/deployments`) do not change meaning: the format moves to **version 2**,
and a version 1 document is migrated when it is loaded (`validateFlowDocument`,
`compileFlowDocument`, `flowFromArtifact`, or explicitly with
`migrateFlowDocument`). The 1 → 2 migration rewrites `retries: N` to
`maxAttempts: N` (an old `retries: 0` behaved like 1 and becomes `maxAttempts: 1`),
so published v1 flows keep their budget. In a version 2 document `retries` has
the new meaning. `isFlowDocument()` only accepts the current version.

## Sends need a running bot

`bot.send()`, `ctx.reply()`, edits and stream updates made before `bot.start()`
(or after a failed start) or after `bot.stop()` used to reach the provider.
They now reject with `BotNotRunningError` (`code: 'BOT_NOT_RUNNING'`) and send
nothing. Sends are accepted from the moment the transport starts connecting, so
a `'ready'` listener can still send.

Concurrent `start()` / `stop()` calls run one at a time in call order: the last
call decides the final state (`start(); stop(); start()` ends running).

## Flow definitions are checked when built

These used to fail only when a user reached the step. They now throw a
`TypeError` when the flow is defined:

- `.choose(prompt, {})` (no options), a non-object `options`, or an option
  without a label;
- `.ask(text, '')` or `.choose(prompt, options, '')` (empty state key);
- invalid `maxAttempts` / `retries` on `.ask()`, `.choose()` and `.form()`.

## Rate-limited `ctx` sends retry once

A `ctx` send (in a handler, a flow or a conversation) rejected with a
`RateLimitedError` asking for a wait of at most 5 s is retried in place. The
alphas retried twice; 2.0 retries once by default and makes it configurable:

```ts
new Bot({ provider, rateLimitRetry: { retries: 2, maxWaitMs: '10s' } })
new Bot({ provider, rateLimitRetry: false })   // never retry in place
```

`bot.send()` is not retried (broadcasts and the durable outbox have their own
back-off).

## Invalid provider events

An event that breaks the normalized contract (not an object, an unknown `kind`,
a message without `chatId`, `ref`, `senderId`, `type` or `body`…) used to fail
deep in the pipeline with a generic `TypeError`. It is now dropped and reported
once on the `'error'` event as an `InvalidProviderEventError`, which names the
provider and the broken field (never ids or message contents).

## A hook that calls `next()` twice

A `before` hook that called `next()` twice threw `next() called multiple times`
and the message was dropped. The first dispatch is now kept (the rest of the
chain runs once, every later `next()` returns the same promise) and the misuse
is reported on the `'error'` event.

## Ids in logs are hashed

The bot's own log lines (access-list and handoff drops, "dispatching message",
typing failures, conversation keys) carried raw chat and sender ids: phone
numbers or emails. They now go through an ids policy, `BotConfig.logIds`:

- `'hash'` (default): HMAC-SHA256, 16 characters, stable within the process.
  With tracing on it is the same hash as the spans (`telemetry.idKey` is reused).
- `'raw'`: the ids as they are, for local debugging.
- `'omit'`: no ids at all.

## Corrupt append logs

With `appendLog`, a bad line at the **end** of `<file>.log` is a torn write and
is cut, as before. A bad line in the **middle** was treated the same way, which
silently dropped every later entry. `FileDurability.open()` and
`SharedFileEventJournal.open()` now refuse such a log with an error whose `code`
is `'APPEND_LOG_CORRUPT'` (it names the file, the line and the byte offset) and
leave the file untouched: restore it from a backup, or cut it at that line.

Snapshots can now be flushed to disk before they replace the previous one:
`FileDurability.open(path, { fsync: true })`, and the same `fsync` option on
`FileEventJournal` and `SharedFileEventJournal`.

## `MemoryCoordinationHub` evicts idle chats

The in-process coordination hub kept per-chat state forever. It now evicts idle
chats beyond `maxIdleKeys` (default 10,000, `Infinity` keeps them all). Fences
stay monotonic across an eviction; a re-created chat reports
`previousHolder: null`, so its next holder refreshes its state. The chat being
used is never evicted, so `maxIdleKeys: 0` keeps only the most recent idle chat.

## `broadcast` retries {#broadcast-retries}

`bot.broadcast(ids, content, { maxRetries })` is now `{ retries }`, with the same
meaning (retries after the first send of each chat). `maxRetries` still works and
is deprecated. The manager's `autoReconnect.maxRetries` is renamed the same way.

## WhatsApp Flow labels default to English

`@botmesh/meta` builds the native WhatsApp Flow of a form with `toFlowJson()` and
`provider.publishForm()`. The submit label is baked into the published Flow, and
its default followed Spanish (`'Enviar'`) while the core moved to English. It now
uses the core default locale: `'Submit'`. The fallbacks used when a bare form
definition is sent without a bot context (`'Open form'`, `'Fill in the form.'`)
follow too. To keep the Spanish labels:

```ts
toFlowJson(definition, { lang: 'es' })
new CloudAPIProvider({ ...config, lang: 'es' })   // every publishForm() of this provider
provider.publishForm(definition, { lang: 'es' })  // or one Flow
```

The provider's `lang` is the language of your bot (`BotConfig.lang`): a bot with
`lang: 'es'` sets the same value on its `CloudAPIProvider`. A `submitLabel` on the definition always wins. Forms sent by a bot already use
the user's `ctx.lang` for the button and the body.
