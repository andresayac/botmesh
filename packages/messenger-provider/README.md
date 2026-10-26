# @botmesh/messenger

The **Facebook Messenger** transport for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core), on Meta's official Send API. It is a sibling of [`@botmesh/meta`](https://www.npmjs.com/package/@botmesh/meta) (WhatsApp Cloud API) and shares its Graph plumbing through [`@botmesh/graph-core`](https://www.npmjs.com/package/@botmesh/graph-core): a webhook with the `hub.challenge` handshake and the `X-Hub-Signature-256` signature for inbound messages, and `POST /{page-id}/messages` for everything outbound. It opens no socket.

## Install

```bash
pnpm add @botmesh/core @botmesh/messenger
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older version. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/messenger@beta` during the beta (`npm view @botmesh/messenger dist-tags` lists the tags). Once stable, the plain command above works.

Nothing else to install: Graph calls use Node.js 22's native `fetch` and `crypto`, and inbound attachments are downloaded through the SSRF-safe [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http) (a dependency).

## Requirements (Meta)

1. An app on [developers.facebook.com](https://developers.facebook.com) with the **Messenger** product and a connected Facebook Page.
2. A **Page access token** with `pages_messaging` (generated in the app's Messenger settings).
3. The app's **app secret** (App settings → Basic): it verifies every webhook.
4. A public **HTTPS webhook** for the Page: set its URL and a `verify_token` you choose, and subscribe the `messages` and `messaging_postbacks` fields (add `message_reactions` to receive reactions and `message_edits` to receive edited messages).

## Usage

```ts
import { Bot } from '@botmesh/core'
import { MessengerProvider, type ChallengeQuery } from '@botmesh/messenger'
import express from 'express'

const provider = new MessengerProvider({
  accessToken: process.env.MESSENGER_TOKEN!,     // Page access token (pages_messaging)
  verifyToken: process.env.META_VERIFY_TOKEN!,   // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,       // required: verifies X-Hub-Signature-256
})

const bot = new Bot({ provider })
bot.when('hi', (ctx) => ctx.reply('👋 Hello from Messenger!'))
await bot.start()

// Your server serves the webhook
const app = express()
app.get('/webhook', (req, res) => {
  const challenge = provider.verifyChallenge(req.query as ChallengeQuery)
  if (challenge === null) res.sendStatus(403)
  else res.send(challenge)
})
// express.raw keeps the exact bytes Meta signed: never parse the body before ingest()
app.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  res.sendStatus(provider.ingest(req.body, req.headers))
})
app.listen(3000)
```

The same two routes work in any framework (or with the [webhook server](https://andresayac.github.io/botmesh/guide/server)): answer the `GET` with `verifyChallenge(query)` and hand the raw `POST` body and headers to `ingest()`, which does not wait for your handlers.

`ingest(body, headers)` returns the HTTP status to answer with and never throws: `200` accepted, `400` for a body that is not a JSON object (or one already parsed while `appSecret` is set), `403` for a bad signature. Fields of the wrong type inside a valid body are ignored, never trusted.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `accessToken` | required | Page access token with `pages_messaging`. An empty value fails in the constructor. |
| `verifyToken` | required | Secret of the webhook `GET` handshake. An empty value fails in the constructor. |
| `appSecret` | required | Verifies `X-Hub-Signature-256` (constant-time HMAC-SHA256 over the raw bytes) on every `POST`. |
| `allowUnsignedWebhooks` | `false` | Isolated local development only: accept webhooks without `appSecret` (logs a warning). |
| `pageId` | `'me'` | Page that owns the Send API endpoint (`me` or its numeric id). |
| `selfId` | none | The Page id. A message whose sender is this id (an echo, if you subscribe `message_echoes`) is marked `fromMe` and skipped. |
| `requestTimeoutMs` | `60000` | Time allowed for each Send API call (send, typing, mark seen); a slower call rejects with a `ProviderError`. |
| `apiVersion` | `'v26.0'` | Graph API version (`DEFAULT_GRAPH_API_VERSION` of `@botmesh/graph-core`). It follows the current version and moves in a minor release; pin it to stay on one. |
| `graphUrl` | `'https://graph.facebook.com'` | Graph base URL (a proxy or a local simulator). |
| `mediaDownload` | HTTPS, public hosts | `secureFetch` policy for inbound attachments (`maxBytes`, `timeoutMs`, `allowHttp`…). |
| `mediaRefHosts` | Meta CDN hosts | Hosts whose attachment URLs may be journaled for durable replays (`BotConfig.durability`). |
| `logger` | pino at `error` | Any `LoggerLike` (pino, `console`…). |
| `debug` | `false` | **Deprecated**: pass a `logger` instead. |

## What it supports

| Feature | Messenger |
| --- | --- |
| Text, image, video, audio, document (by public URL) | ✅ |
| Postback buttons (`ctx.buttons`, button template, max 3; a button with `url` is a `web_url` button). Text past the template's 640 characters goes first as plain text | ✅ native |
| Cards (`card` with an image or buttons → generic template; without them, text) | ✅ native |
| Lists (the list text, then a generic template with one element per row, max 10) | ✅ native |
| Quick replies and postbacks → interactions (`kind: 'button'`) | ✅ |
| Inbound location (`type: 'location'`) and replies (`ctx.quoted`) | ✅ |
| Shared links (`fallback` attachments) → a text message with the link title and URL | ✅ |
| Several attachments in one message (one message each: the first keeps the `mid` and the text, the next ones are `<mid>#2`, `<mid>#3`…) | ✅ |
| Edited messages (`message_edits`: the edit arrives as a new message with the original id; `isEditedMessage(ctx)` tells it apart) | ✅ |
| Message tags and delivery options (`platformData`: `tag`, `messaging_type`, `notification_type`, `persona_id`) | ✅ |
| Inbound reactions (`message_reactions` → `reaction` event; `emoji` is the character, `removed` on `unreact`) | ✅ |
| Typing (`typing_on`/`typing_off`) and read receipts (`mark_seen`) | ✅ |
| Inbound media download (`MediaRef.token` is the attachment URL) | ✅ |
| Text over 2000 characters (`maxTextLength`) | ✅ split into several messages by `@botmesh/core` |
| `ctx.sendNative('messenger', message)` | ✅ posts a Send API `message` object as is |
| Polls, stickers, location, contact, templates, sending reactions | ❌ `UnsupportedContentError` (no Send API for them) |
| Groups, presence, editing or deleting messages | ❌ (not in the API) |

- **Media by public URL only.** The Send API refers to attachments by URL; this provider does not implement the chunked upload. A `Buffer`, a path or a stream rejects with `UnsupportedContentError`: host the file and pass `'https://…'` or `{ url }`.
- **Replies are not threaded on send:** the Send API has no reply context, so `options.quoted` is ignored.
- **Message tags:** a send is `messaging_type: 'RESPONSE'` unless `options.platformData` says otherwise. `bot.send(psid, text, { platformData: { tag: 'HUMAN_AGENT' } })` sends with an approved [message tag](https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags) after the 24-hour window (`messaging_type` becomes `'MESSAGE_TAG'`); `notification_type` (`'REGULAR'`, `'SILENT_PUSH'`, `'NO_PUSH'`) and `persona_id` are passed too. A value of the wrong type throws a `TypeError` before the call; other keys are ignored.
- **Edits:** an edited message is delivered again with its original `ref.id` and the new text (the core deduplicates by id and content, so it is not dropped). It also reaches an active conversation as an answer; check `isEditedMessage(ctx)` (exported by this package) to treat it differently.
- **Identity:** `chatId` and `senderId` are the user's Page-scoped id (`sender.id`), stable for each Page and user.
- `acknowledgeInteraction()` is a no-op: postbacks need no ack.

## Errors you may see

Sends reject with the typed errors of `@botmesh/core` (mapping in [`@botmesh/graph-core`](https://www.npmjs.com/package/@botmesh/graph-core); `toMessengerError()` exposes it):

| Error | Typical cause | What to do |
| --- | --- | --- |
| `OutsideSessionWindowError` (code `10`, subcode `2018278`) | More than 24 h since the user's last message | Wait for the user to write again, or send with a message tag your app is approved for: `bot.send(psid, text, { platformData: { tag: 'HUMAN_AGENT' } })`. |
| `RecipientUnreachableError` (code `551`, subcodes `1545041`/`2018001`) | The user is unavailable, blocked the Page or does not exist | Stop sending to that id. |
| `RateLimitedError` (codes `4`/`613`) | Page or app rate limit | Wait `retryAfterMs`; `ctx` sends and `bot.broadcast()` already retry short waits. |
| `UnsupportedContentError` | Poll, sticker, location, contact, template, a non-URL media source, more than 3 buttons or 10 list rows | Use buttons, a list or text; host media and pass its URL. |
| `ProviderError` (code `190`) | Wrong or expired Page token | Generate a Page access token with `pages_messaging`. |
| `ProviderError` ("timed out") | A Send API call took longer than `requestTimeoutMs` | Check connectivity to Graph, or raise the timeout. |
| `TypeError` naming `platformData.<key>` | A delivery option of the wrong type, or `messaging_type: 'MESSAGE_TAG'` without a `tag` | Pass strings: `tag`, `messaging_type` (`RESPONSE`, `UPDATE`, `MESSAGE_TAG`), `notification_type`, `persona_id`. |
| Constructor error naming a field | `accessToken` or `verifyToken` empty, or `appSecret` missing | Check the environment variables. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Meta says the callback URL could not be verified | The `GET` route answered `403`: the `verify_token` set in Meta differs from `verifyToken`, or the route does not return `verifyChallenge(query)` as plain text. |
| Every webhook `POST` gets `403` | The signature check failed: `appSecret` is not the app's secret, or the body reached `ingest()` re-serialized (parse nothing before it; pass the raw bytes). See [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting#webhook-signature-mismatch-403). |
| Webhook `POST`s get `400` | The body is not a JSON object, or a parsed object was passed while `appSecret` is set. |
| The webhook verifies but no message arrives | The Page is not subscribed to the app's `messages` field, or the app is in development mode and the sender has no role in it. |
| Button presses never arrive | `messaging_postbacks` is not subscribed. |
| Reactions never arrive | `message_reactions` is not subscribed. |
| Edited messages never arrive | `message_edits` is not subscribed. |

## Internal entry

`@botmesh/messenger/internal` exports the wire helpers (`parseInbound`, `toOutbound`, `toOutboundMessages`) for tooling and tests. It has **no semver guarantee**: any of them may change in a minor release. Applications only need `ingest()` and the bot.

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels#botmesh-messenger) · [Webhook server](https://andresayac.github.io/botmesh/guide/server) · [Local sandbox](https://andresayac.github.io/botmesh/guide/sandbox) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/messenger-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/messenger-provider) · [Issues](https://github.com/andresayac/botmesh/issues)
