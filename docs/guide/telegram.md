# Telegram

Telegram Bot API. Long polling by default; `polling: false` switches to
webhook mode, where `webhookSecret` is required.

## Install

```bash
pnpm add @botmesh/core @botmesh/telegram
```

## Usage

- **Polling** needs no public URL: use it in development and for a bot that
  runs as one process. Only one poller per token may run (a second one gets
  `409` and the provider stops).
- **Webhook** suits serverless and multi-replica deployments behind HTTPS.
  Register the URL once with the Bot API's `setWebhook`, passing the same
  secret as `secret_token`.

```ts
import { TelegramProvider } from '@botmesh/telegram'

const provider = new TelegramProvider({ token: process.env.TELEGRAM_TOKEN! })

// Webhook mode: the same secret goes to setWebhook (secret_token)
const hooked = new TelegramProvider({
  token: process.env.TELEGRAM_TOKEN!,
  polling: false,
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET!,
})
```

- Inline keyboards, native polls, reactions, message edits.
- `ctx.stream()` uses native drafts in private chats and edits elsewhere.
- In webhook mode `ingest(body, headers)` takes the raw bytes, the JSON
  string or the parsed object, and checks the `X-Telegram-Bot-Api-Secret-Token`
  header (any case, plain or Fetch `Headers`). `@botmesh/server` needs no
  extra option. After `stop()` it answers `503` and emits nothing, so
  Telegram redelivers those Updates once the bot is back.
- **Group commands** addressed to the bot (`/menu@MyBot`) reach
  `bot.command('menu')`, also in a media caption: the provider drops the
  suffix when it names this bot (username from `getMe`, or the `username`
  option when you pass `selfId`).
- **Mentions of the bot**: an `@MyBot` in the text and a command addressed as
  `/menu@MyBot` put the bot's `selfId` in `ctx.mentions`, so
  `groupMode: 'mentions'` lets them through. Other `@username` mentions carry
  no user id and are not listed; a `text_mention` (a user without username)
  is.
- Every Bot API request has a client timeout (`requestTimeoutMs`, 120 s by
  default; long polls get `pollTimeoutMs` (30 s by default) + 15 s; file uploads get
  `uploadTimeoutMs`, 5 min by default), errors never carry the bot token, a
  429 `retry_after` is honoured up to 24 h, and `bot.stop()` cuts the poll
  loop's retry waits at once.
- **Edited messages** reach the bot as messages with the new text and the
  original `ref.id` (replies, reactions and edits target the edited message).
  `isEditedMessage(ctx)` tells them apart; the core deduper lets an edit
  through because its content changed. `editedMessages: 'ignore'` turns them off.
- **Poll votes**: polls are sent non-anonymous (`is_anonymous: false`), so each
  vote arrives as a `poll_answer` update and becomes a `'poll'` event with the
  tally, like on WhatsApp. Chat members can see who voted; `anonymousPolls: true`
  sends anonymous polls, whose votes never reach the bot. Votes are tallied for
  polls this process sent (in memory, the last 500): a vote on a poll sent before
  a restart is dropped. Channels do not allow public-voter polls: a poll to a
  channel is retried once as anonymous (no votes) and that channel gets anonymous
  polls from then on.
- **Self-hosted Bot API server**: set `baseUrl` to it. On plain HTTP or a
  private network, media downloads also need `mediaDownload: { allowHttp: true,
  allowPrivateHosts: true }` (plus a larger `maxBytes`). Run the server without
  `--local`, whose file paths are not served over HTTP.

```ts
import { TelegramProvider, isEditedMessage } from '@botmesh/telegram'

const selfHosted = new TelegramProvider({
  token: process.env.TELEGRAM_TOKEN!,
  baseUrl: 'http://telegram-bot-api:8081',
  mediaDownload: { allowHttp: true, allowPrivateHosts: true, maxBytes: 200 * 1024 * 1024 },
})
bot.before('message', async (ctx, next) => { if (!isEditedMessage(ctx)) await next() }) // skip edits
```

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Streaming replies](/guide/streaming): native drafts in private chats.
- [Webhook server](/guide/server): webhook mode with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/telegram-provider)
