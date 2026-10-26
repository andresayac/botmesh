# @botmesh/telegram

Telegram Bot API transport ([`IProvider` v2](https://github.com/andresayac/botmesh/blob/main/packages/core/src/core/provider.ts)) for
[@botmesh/core](https://github.com/andresayac/botmesh/tree/main/packages/core). Plain HTTP over Node's global `fetch` — no extra
runtime dependencies beyond `@botmesh/core` and `pino`.

- **Ingress:** long-polling (`getUpdates`, default) **or** webhook (`ingest()`).
- **Outbound:** text, photo, video, audio, voice, document, sticker, location,
  contact, **native polls**, reactions, inline keyboards (buttons; lists degrade
  to a keyboard), card, and a `native` passthrough to any Bot API method.
- **Actions:** `editMessageText`, `deleteMessage`, `sendChatAction` (typing),
  `answerCallbackQuery` (interaction ack), media download via `getFile`.
- Media sources: public URL, Telegram `file_id` (reuse via `{ native: file_id }`),
  `Buffer`, file path, or stream (uploaded as multipart/form-data).

## Install

In the monorepo the workspace package is already available. From an app:

```bash
pnpm add @botmesh/core @botmesh/telegram
```

Create a bot with [@BotFather](https://t.me/BotFather) and keep the token.

## Config

```ts
interface TelegramProviderConfig {
  token: string        // bot token from @BotFather (required; the constructor throws if missing)
  baseUrl?: string     // default 'https://api.telegram.org' (or your self-hosted Bot API server)
  mediaDownload?: SecureFetchOptions // download policy: maxBytes, timeoutMs, allowHttp, allowPrivateHosts
  editedMessages?: 'deliver' | 'ignore' // default 'deliver' (see "Edited messages")
  polling?: boolean    // default true; false = webhook mode (host calls ingest())
  webhookSecret?: string        // webhook mode: required, same value as setWebhook's secret_token
  allowUnsignedWebhooks?: boolean // webhook mode without a secret: isolated local development only
  selfId?: string      // bot's own user id; resolved via getMe() when omitted
  username?: string    // bot's @username; learned from getMe() when selfId is omitted (see "Group commands")
  pollTimeout?: number // getUpdates server timeout (s), default 30
  errorBackoffMs?: number  // base backoff after a failed poll round (doubles per failure), default 1000
  maxBackoffMs?: number    // ceiling for that backoff, default 60000
  pollIdleMs?: number      // pause after an empty batch, default 250
  requestTimeoutMs?: number // client timeout per Bot API request (uploads included), default 120000
  debug?: boolean
  logger?: LoggerLike  // pino, console or any { debug, info, warn, error }
}
```

Invalid options (no token, a `baseUrl` that is not an absolute http(s) URL,
negative or non-numeric timings) throw a `TypeError` from the constructor.

## Usage — long-poll (default)

```ts
import { Bot } from '@botmesh/core'
import { TelegramProvider } from '@botmesh/telegram'

const provider = new TelegramProvider({ token: process.env.TG_TOKEN! })

const bot = new Bot({ provider })
bot.when(/^hola/i, async (ctx) => {
  await ctx.reply(`¡Hola ${ctx.pushName ?? ''}! 👋`)
  await ctx.poll('¿Color favorito?', ['Rojo', 'Azul'])          // native poll
  await ctx.buttons('Elige', [                                   // inline keyboard
    { id: 'yes', title: 'Sí' },
    { id: 'no', title: 'No' },
  ])
})
bot.onMessage(async (ctx) => {
  if (!ctx.interaction) return ctx.pass()                        // only button presses here
  await ctx.acknowledge?.('recibido')                            // answerCallbackQuery
  await ctx.reply(`Elegiste ${ctx.interaction.data}`)             // 'yes' | 'no'
})
await bot.start()   // resolves selfId via getMe, then polls getUpdates
await bot.ready     // first getUpdates round answered (it does not long-poll)
```

`callback_query` updates arrive as interactions; `ctx.interaction` is set
(`data` is the pressed button's `id`) and `ctx.acknowledge(text?)` calls
`answerCallbackQuery`. Button ids travel as `callback_data`, which Telegram
caps at 64 bytes: keep ids short (a longer id is cut and will not match).

`bot.stop()` aborts the in-flight long poll and any retry wait at once, and
leaves no timers behind; `start()` again resumes from the last offset.

## Usage — webhook (Express)

```ts
import express from 'express'
import { Bot } from '@botmesh/core'
import { TelegramProvider } from '@botmesh/telegram'

const provider = new TelegramProvider({
  token: process.env.TG_TOKEN!,
  polling: false,
  webhookSecret: process.env.TG_WEBHOOK_SECRET!, // also passed to setWebhook as secret_token
})
const bot = new Bot({ provider })
bot.when('hola', async (ctx) => { await ctx.reply('¡Hola!') })
await bot.start()

const app = express()
app.post('/telegram', express.raw({ type: '*/*' }), (req, res) => {
  // ingest() checks X-Telegram-Bot-Api-Secret-Token (timing-safe) and parses the body.
  res.sendStatus(provider.ingest(req.body, req.headers)) // 200 accepted / 401 bad secret / 400 bad body
})
app.listen(3000)
// Register once: POST /bot<token>/setWebhook { url: 'https://…/telegram', secret_token: TG_WEBHOOK_SECRET }
```

`ingest(body, headers)` accepts the raw bytes (`Buffer`/`Uint8Array`), the JSON
string or the parsed object, and plain or Fetch `Headers` (any case). It
returns the HTTP status to answer with (Telegram retries anything non-2xx); an
Update the provider cannot normalize is logged (without its content) and
acknowledged with 200, since a retry would fail the same way. With
[`@botmesh/server`](https://github.com/andresayac/botmesh/blob/main/docs/guide/server.md)
mount the provider as a route; no extra wiring is needed.

## Media

```ts
await ctx.photo('https://example.com/i.png', 'caption')  // URL — Telegram fetches it
await ctx.photo({ native: 'AgACAgEAAx...' })             // reuse an existing file_id
await ctx.file(Buffer.from(bytes), 'report.pdf')         // multipart upload
await ctx.file('/tmp/report.pdf')                        // local path → upload

// Inbound media is lazy: download it on demand
import { loadMediaOf } from '@botmesh/core'
bot.onType('image', async (ctx) => {
  const media = await loadMediaOf(ctx, { maxBytes: 10 * 1024 * 1024 }) // undefined if the download fails
  if (media) await ctx.reply(`Got ${media.buffer.length} bytes (${media.mimetype})`)
})
```

A media **string** is a URL (`http(s)://…`) or a local file path. To reuse a
Telegram `file_id`, pass `{ native: file_id }`: a bare string that is neither a
URL nor a readable file rejects with an `UnsupportedContentError` saying so.

`downloadMedia(ref)` resolves `file_id → getFile → file_path` and fetches
`{baseUrl}/file/bot{token}/{file_path}` (20 MB Bot API limit) through the
anti-SSRF `secureFetch` of `@botmesh/http`. Download failures reject with typed
errors (`PayloadTooLargeError` over `mediaDownload.maxBytes`, 16 MiB by default;
`ProviderError` otherwise) whose messages never include the URL (it carries the token).

## Self-hosted Bot API server

A [self-hosted Bot API server](https://github.com/tdlib/telegram-bot-api) lifts
the cloud limits (downloads up to 2000 MB, uploads up to 2000 MB). Point
`baseUrl` at it. It usually runs on plain HTTP inside your network, which the
download guard refuses by default, so allow it explicitly:

```ts
const provider = new TelegramProvider({
  token: process.env.TG_TOKEN!,
  baseUrl: 'http://telegram-bot-api:8081',   // your server (Docker service, LAN, localhost)
  mediaDownload: {
    allowHttp: true,          // the server speaks plain HTTP
    allowPrivateHosts: true,  // and lives on a private/loopback address
    maxBytes: 200 * 1024 * 1024,
    timeoutMs: 120_000,
  },
})
```

- Only enable `allowHttp` / `allowPrivateHosts` for a server you control: they
  relax the SSRF protection for every file download of this provider.
- Call `logOut` on the cloud API once before switching a bot to your server
  (Telegram's requirement), then `getUpdates`/`setWebhook` against the new `baseUrl`.
- Run the server **without** `--local`: in local mode `getFile` returns a path on
  the server's disk that is not served over HTTP, and `downloadMedia` rejects
  with a `ProviderError` explaining it.

## Edited messages

By default (`editedMessages: 'deliver'`) an `edited_message` update reaches the
bot as a normal message with the new text:

- it keeps the original `ref.id`, so `ctx.reply`, `ctx.react` and `ctx.edit`
  target the edited message, and a store upsert updates it in place;
- `ref.native.edit_date` and `raw.edit_date` (unix seconds) are set, and
  `isEditedMessage(message)` returns `true`;
- the core deduper keys on `chatId + ref.id` plus a content fingerprint, so the
  edit (different text) gets through while a webhook retry of the same edit, or
  an edit that leaves the text unchanged, is dropped.

An edit is routed like any message (it can answer a pending `ask()`). If that
is not what you want, branch on it or turn edits off:

```ts
import { TelegramProvider, isEditedMessage } from '@botmesh/telegram'

bot.before('message', async (ctx, next) => { if (!isEditedMessage(ctx)) await next() }) // skip edits
new TelegramProvider({ token, editedMessages: 'ignore' })                   // or never receive them
```

With `'ignore'` long-polling stops requesting `edited_message`; in webhook mode
the update is acknowledged (200) and dropped (also leave it out of
`setWebhook`'s `allowed_updates`).

## Capabilities

| Capability               | Value  | Notes                                             |
| ------------------------ | ------ | ------------------------------------------------- |
| `buttons`                | ✅     | inline keyboard (`callback_data` = button id, cut to 64 bytes) |
| `lists`                  | ❌     | degrades to an inline keyboard                    |
| `polls`                  | ✅     | native `sendPoll`                                 |
| `reactions`              | ✅     | `setMessageReaction`                              |
| `edit`                   | ✅     | `editMessageText` (text only)                     |
| `typing`                 | ✅     | `sendChatAction` (typing / record_voice)          |
| `presence`               | ❌     | bots cannot read presence                         |
| `readReceipts`           | ❌     | bots get no read receipts (`markRead` is a no-op) |
| `groups`                 | ✅     | group / supergroup / channel classification       |
| `templates`              | ❌     | use `text`/`buttons`/`native`                     |
| `interactionsRequireAck` | ❌     | `answerCallbackQuery` stops the spinner; no hard deadline |
| `pushIngress`            | ✅     | webhook supported; long-poll also owned           |

## Error mapping

Bot API errors become typed `@botmesh/core` errors:

| HTTP | Maps to                                              |
| ---- | ---------------------------------------------------- |
| 429  | `RateLimitedError` (`retryAfterMs` from `retry_after`) |
| 403  | `RecipientUnreachableError` (bot blocked / kicked)   |
| 400 *chat not found*, *user not found*, *bot is not a member*… | `RecipientUnreachableError` |
| 400 *message is too long* / *file is too big*, 413 | `PayloadTooLargeError` |
| 401  | `ProviderError` + connection `sessionInvalid` (also mid-run: the poll loop stops) |
| 409 conflict (two pollers) | connection `sessionTakenOver`, poll loop stops |
| no answer within `requestTimeoutMs` | `ProviderError` ("timed out") |
| network failure (DNS, TLS, reset) | `ProviderError` (`cause` keeps the code) |

No error message, `cause` or log line carries the bot token, even when the
underlying `fetch` error quotes the request URL. In the poll loop a 429 waits
`retry_after` and other failures back off exponentially (`errorBackoffMs` up to
`maxBackoffMs`); a long poll that hangs past `pollTimeout` + 15 s is abandoned
and retried, so a half-open connection never silences the bot.

## Group commands

In groups, Telegram clients address commands to one bot as `/menu@MyBot`. The
provider drops the suffix when it names **this** bot (case-insensitive), so
`bot.command('menu')` matches; a command for another bot (`/menu@OtherBot`) is
left as is. The username comes from `getMe`; if you pass `selfId` (which skips
`getMe`), also pass `username`. `ctx.raw` (the Telegram message) keeps the original text.

## Notes

- Identity is resolved inside the provider: `chatId = String(chat.id)`,
  `senderId = String(from.id)` (fallbacks: `sender_chat.id`, then `chat.id`).
  Timestamps are emitted as epoch **milliseconds**.
- Long-poll and webhook share one ingress path; never run two pollers on the
  same token (Telegram returns 409 and the provider stops deliberately).
- ESM only (`"type": "module"`); relative imports carry `.js` extensions.
