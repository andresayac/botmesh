# Configuration reference

Everything `new Bot(config)` accepts, the events the bot emits, how it logs and
the errors you can catch. The other guides explain each feature; this page is
the lookup table.

```ts
import { Bot, MemoryStore } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'my-bot' }), // the only required option
  store: new MemoryStore({ file: './store.json' }),
  lang: 'es',
  groupMode: 'mentions',
  conversation: { timeout: '10m' },
  typing: true,
})
```

`new Bot()` validates the whole object and throws a
[`ConfigValidationError`](#errors) that names the first wrong option.

## `BotConfig` options

### Essentials

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `provider` | `IProvider` | required | The transport: `BaileysProvider`, `CloudAPIProvider`, `TelegramProvider`… See [Channels](./channels). |
| `store` | `IStore` | in-memory `MemoryStore` | Where chats, contacts, messages, flow checkpoints and `ctx.user` data live. See [Persistent store](./store). |
| `lang` | `string` | `'en'` | Language of the built-in texts (timeouts, retries, slash commands, form prompts) and of `ctx.lang`. `'es'` is also bundled. Does not turn on per-user resolution; see [i18n](./i18n#a-single-language-bot-lang). |
| `i18n` | `I18nConfig` | off | Per-user language resolution: `defaultLocale`, `locales`, `detect`, `providerLanguage`, `userKey`. See [i18n](./i18n). |
| `logger` | `LoggerLike` | built-in pino at `warn` | Any pino-style logger. See [Logging](#logging). |
| `debug` | `boolean` | `false` | Built-in logger at `debug` level (ignored when `logger` is set). |

### Routing and conversations

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `commandPrefix` | `string` | `'/'` | Prefix that marks a message as a command for `bot.command()`. |
| `groupMode` | `'all' \| 'mentions' \| 'commands'` | `'all'` | Which group messages are routed: everything, only messages that mention the bot, or only commands. Filtered messages are still stored. |
| `conversationScope` | `'participant' \| 'chat'` | `'participant'` | In groups, one conversation per participant or one shared per chat. |
| `conversation.timeout` | duration | `'5m'` | How long a wait (`ask`, `choose`, `waitText`…) lasts when the step sets no `timeout`. |
| `conversation.timeoutMessage` | `string` | built-in `core.conversation.timeout` | Sent when a wait times out. |
| `conversation.retriesMessage` | `string` | built-in | Sent when a wait runs out of `maxAttempts`. |
| `conversation.errorMessage` | `string` | built-in | Sent when a conversation step throws. |
| `conversation.cancelledMessage` | `string` | built-in | Sent when a conversation is cancelled (`/reset`, a replacement). |
| `handoff` | `{ allowCommands?, persist? }` | `{ persist: true }` | Human handoff: commands that still run while a chat is handed off, and whether the state is stored. See [Handoff](./handoff). |
| `dedupe` | `{ size?, ttl? } \| false` | `{ size: 1000 }` | Drop redelivered inbound messages. See [Inbound dedupe](./concepts#inbound-dedupe). |
| `echoFilter` | `{ size?, ttl? } \| true` | off | Drop inbound messages that are the bot's own sends. See [Echo filter](./concepts#echo-filter). |

A message in `conversation.*` wins over the localized built-in text; to
translate the built-ins instead, see [Built-in messages](./i18n#built-in-messages).

### Sending

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `typing` | `boolean \| { enabled?, minMs?, maxMs?, charsPerSecond? }` | off | Show "typing…" before each text reply sent through `ctx` and flow `.say`. `true` = `{ minMs: '800ms', maxMs: '3s', charsPerSecond: 20 }`. See [Typing indicator](./messages#typing-indicator-and-reply-delays). |
| `splitLongText` | `boolean` | `true` | Split a text longer than the channel's limit into several messages (at paragraph, sentence or word boundaries). `false` sends it whole, and the provider may reject it with `PayloadTooLargeError`. |
| `rateLimitRetry` | `{ retries?, maxWaitMs? } \| false` | `{ retries: 1, maxWaitMs: '5s' }` | Retry a `ctx` send in place when the transport answers "rate limited, retry in N s" and N is short. `retries` counts attempts after the first. See [Rate limiting](./rate-limiting). |
| `rateLimit` | `object` | none | **Deprecated, ignored.** The core does not pace sends and logs a warning if you set it; pass `rateLimit` to the provider instead (see [Rate limiting](./rate-limiting)) and use `rateLimitRetry` for rate-limited replies. Removed in the next major. |

### Identity and storage namespace

These ids namespace everything the bot writes (store rows, user data,
schedules, durable journals, traces), so two bots can share one database.

| Option | Default | What it is |
| --- | --- | --- |
| `session` | none | A short name for this bot. Used as the default of `botId` and `connectionId`. |
| `tenantId` | `'local'` | Tenant namespace. |
| `environmentId` | `'default'` | Environment namespace (`'prod'`, `'staging'`…). |
| `botId` | `session`, else the provider id | Stable bot id. |
| `connectionId` | `session`, else `'default'` | Provider account or connection id. |
| `persistRaw` | `false` | Also store the provider's native payloads. Off to keep less personal data. |

Changing any of them later makes the bot look in a new namespace: existing
rows stay under the old one.

### Production features (opt-in)

Each one is off until you set it, and then has its own guide.

| Option | What it turns on | Guide |
| --- | --- | --- |
| `durability` | Inbound journal and outbound outbox with retries and a dead-letter queue | [Durable processing](./durability) |
| `coordination` | Several replicas sharing chats in order, one leader for exclusive sessions | [Running N replicas](./replicas) |
| `scheduler` | Store, lease and default time zone of durable scheduled tasks | [Scheduler](./scheduler#backends) |
| `telemetry` | OpenTelemetry-style spans for every message, send and task | [Tracing](./tracing) |
| `logIds` | How chat and sender ids appear in logs: `'hash'` (default), `'raw'` or `'omit'` | [Logging](#logging) |

`storeConfig` is deprecated: pass `store: new MemoryStore({ file, maxMessagesPerChat, autoSaveInterval })`.

## Durations

Every duration option takes a string or a number of milliseconds. That
includes every option whose name ends in `Ms` (`typing.minMs`,
`coordination.turnWaitMs`, `scheduler.tickMs`, `durability.outbox.backoff.baseMs`…):

| Write | Means |
| --- | --- |
| `500` | 500 ms |
| `'500ms'`, `'30s'`, `'2m'`, `'1h'`, `'1d'`, `'1w'` | the usual units |
| `'30 seconds'`, `'5 minutes'`, `'2 hours'`, `'1 day'` | long names work too |

```ts
const bot = new Bot({
  provider,
  typing: { minMs: '800ms', maxMs: '3s' },
  durability: { pollMs: '1s', outbox: { inlineMaxMs: '15s', backoff: { baseMs: '1s', capMs: '1m' } } },
})
```

An invalid value fails fast, naming the option:

```text
ConfigValidationError: Invalid config.durability.pollMs: expected a duration ('500ms', '30s', '10m', '1h') or milliseconds, got string ("soon")
```

`parseDuration('2m')` (from `@botmesh/core`) reads the same grammar and returns
milliseconds.

## Lifecycle and events

```ts
await bot.start()                 // connect the transport; sends are accepted from now on
await bot.stop({ drain: true })   // finish in-flight sends first (`timeout`, default '10s', caps the wait)
```

- Sends, edits and `ctx.delete()` before `start()` or after `stop()` reject
  with `BotNotRunningError`. A `'ready'` listener can already send.
- `start()` and `stop()` calls run one at a time, in call order.
- Presence hints (`ctx.typing()`, `ctx.markRead()`) never throw while the
  transport is disconnected: they are skipped and counted in
  `metrics().presenceSkipped`.

Listen with `bot.on(event, fn)` (`bot.once`, `bot.off` too):

| Event | Payload | When |
| --- | --- | --- |
| `qr` | `string` | A QR (or pairing code) to link the account (Baileys). |
| `connection` | `ConnectionUpdate` | The transport's connection state changed. |
| `ready` | none | The transport is connected. |
| `started` / `stopping` / `stopped` | none | Lifecycle. `stopping` fires before the drain: cancel long work there. |
| `message` | `MessageContext` | After every processed message, even one a handler consumed. |
| `command:unknown` | `{ ctx, command }` | A `/command` nobody registered. |
| `error` | `{ error, ctx? }` | A handler, hook, store or provider error. Always emitted. |
| `reaction`, `poll`, `call`, `group`, `presence`, `status` | provider event | Reactions, poll votes, calls, group updates, presence, delivery receipts. |
| `handoff` / `resume` | `HandoffEvent` / `ResumeEvent` | A chat was handed to a human / given back. |
| `conversation:started` / `conversation:ended` | conversation info | See [Operations](./operations#conversation-events). |
| `coordination:*`, `durability:*` | | Only with those features on; see their guides. |

::: tip Always listen to `'error'`
Errors never crash the process, so without a listener they are only logged.
`bot.on('error', ({ error, ctx }) => ...)` is where you report them.
:::

## Logging

`logger` takes a `LoggerLike`: pino, `console`, or any object with `debug`,
`info`, `warn` and `error`. Providers and stores take the same `logger`
option. The packages always call it pino style, so a custom logger only has
to handle two shapes:

```ts
logger.warn('provider reconnected')                  // a message
logger.error({ err, chatId }, 'dispatch error')      // context object first, then the message
```

An error always goes under the `err` key, and `child(bindings)` is optional.
Without `logger` the bot uses its own pino logger at `warn` (`debug: true`
lowers it to `debug`); `bot.logger` is the logger in use.

Chat and sender ids are personal data (phone numbers, emails), so the bot's
own log lines hash them by default:

| `logIds` | Log lines show |
| --- | --- |
| `'hash'` (default) | an HMAC-SHA256 of the id, 16 characters, stable within the process (the same hash as trace spans) |
| `'raw'` | the id as is, for local debugging |
| `'omit'` | no ids |

Message bodies are never logged.

## Errors

All are exported by `@botmesh/core`. Test with `instanceof`; most also carry a
stable `code` or `name`.

| Error | When | What to do |
| --- | --- | --- |
| `ConfigValidationError` | `new Bot()` got an invalid option. `field` is the option path. | Fix the option the message names. |
| `BotNotRunningError` | A send, edit or delete before `start()` or after `stop()` (`code: 'BOT_NOT_RUNNING'`). | Send after `start()`, or from a `'ready'` listener. |
| `ProviderError` | Base of every typed send error below. | Catch it to handle any send failure. |
| `UnsupportedContentError` | The channel cannot send this content (no buttons, no stickers, too many options…). | Check `ctx.supports()` or send something simpler. |
| `RateLimitedError` | The platform throttled the send; `retryAfterMs` when known. | Back off; `ctx` sends retry short waits once on their own. |
| `RecipientUnreachableError` | The chat does not exist, blocked the bot or cannot be reached. | Stop sending to that chat. |
| `PayloadTooLargeError` | The message or media is over the platform's limit. `MediaTooLargeError` is the inbound case (`loadMediaOf` `maxBytes`). | Send less, or a link. |
| `OutsideSessionWindowError` | WhatsApp Cloud API: the 24-hour window is closed. | Send a template. See [24h window](./session-window). |
| `MediaUnavailableError` | Inbound media can no longer be downloaded (a replayed message, a mock without bytes). | Ask the user to send it again. |
| `SendDeferredError` | Durable outbox: the send did not finish within `inlineMaxMs`; it is queued and will be retried. | Nothing; watch `'durability:dead'` for final failures. |
| `ConversationError` | Base of the conversation control signals: `ConversationTimeout`, `ConversationCancelled`, `RetriesExceeded`, `ConversationEnded`, `ConversationGoto`. | If you wrap a step in `try/catch`, rethrow it: `if (e instanceof ConversationError) throw e`. |
| `ConcurrentWaitError` | A second wait started while one is pending (an un-awaited `c.ask()` or `c.retry()`). | `await` every wait. |
| `RetryUnavailableError` | `c.retry()` with no previous wait. | Call it after a wait. |
| `UserDataError` | Invalid `ctx.user` path, value, TTL or namespace, or a store without user data (`code`). | See [User data errors](./user-data#errors). |
| `InvalidProviderEventError` | A provider emitted a malformed event; it was dropped (reported on `'error'`). | Fix the provider. |
| `LeaseLostError`, `ProviderNotLeaderError`, `CoordinationUnavailableError` | Multi-replica only: the chat's turn or the leadership was lost. | See [Running N replicas](./replicas). |
| `TimeoutError` | A deadline expired: an `@botmesh/ai` model or tool call, or a test-kit wait such as `chaos.settle()`. | Retry, or raise that timeout. |

## Next steps

- [Core concepts](./concepts): the inbound pipeline and the building blocks
- [Messages & media](./messages): everything `ctx` can send
- [Operations](./operations): metrics, health and conversation events
