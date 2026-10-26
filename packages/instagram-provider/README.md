# @botmesh/instagram

The **Instagram DM** transport for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core), on Meta's official Messenger API for Instagram. It shares its Graph plumbing with [`@botmesh/meta`](https://www.npmjs.com/package/@botmesh/meta) and [`@botmesh/messenger`](https://www.npmjs.com/package/@botmesh/messenger) through [`@botmesh/graph-core`](https://www.npmjs.com/package/@botmesh/graph-core). It is webhook-based (it opens no socket): DMs arrive on the `page` webhook of the Facebook Page the Instagram account is connected to, and sends go through the Graph Send API (`me/messages`).

## Install

```bash
pnpm add @botmesh/core @botmesh/instagram
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build (or to none). Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/instagram@beta` during the beta (`npm view @botmesh/instagram dist-tags` lists the tags). Once stable, the plain command above works.

Nothing else to install: Graph calls use Node.js 22's native `fetch` and `crypto`, and inbound attachments are downloaded through the SSRF-safe [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http) (a dependency).

## Requirements (Meta)

1. A **professional Instagram account** (business or creator) **connected to a Facebook Page**: DMs are routed through that Page.
2. An app on [developers.facebook.com](https://developers.facebook.com) with the **Messenger** product, the Instagram account connected (Messenger API for Instagram) and the `instagram_basic`, `instagram_manage_messages` and `pages_manage_metadata` permissions.
3. A **Page access token** for the connected Page, and the app's **app secret** (App settings → Basic).
4. A public **HTTPS webhook** on the `page` object (`instagram` is also accepted) with the `messages`, `messaging_postbacks` and `message_reactions` fields, pointing at your server with a `verify_token` you choose.

## Usage

```ts
import { Bot } from '@botmesh/core'
import { InstagramProvider, type ChallengeQuery } from '@botmesh/instagram'
import express from 'express'

const provider = new InstagramProvider({
  accessToken: process.env.META_PAGE_TOKEN!,      // token of the connected Page
  verifyToken: process.env.META_VERIFY_TOKEN!,    // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,        // required: verifies X-Hub-Signature-256
})

const bot = new Bot({ provider })
bot.when('hi', (ctx) => ctx.reply('👋 Hello from Instagram!'))
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

`ingest(body, headers)` returns the HTTP status to answer with and never throws: `200` accepted, `400` for a body that is not a JSON object (or one already parsed while `appSecret` is set), `403` for a bad signature, `503` while the provider is stopped (after `bot.stop()`, until the next `bot.start()`), so Meta delivers the webhook again later instead of it being lost. Fields of the wrong type inside a valid body are ignored, never trusted.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `accessToken` | required | Access token of the connected Facebook Page. An empty value fails in the constructor. |
| `verifyToken` | required | Secret of the webhook `GET` handshake. An empty or blank value fails in the constructor. |
| `appSecret` | required | Verifies `X-Hub-Signature-256` (constant-time HMAC-SHA256 over the raw bytes) on every `POST`. A blank value fails in the constructor. |
| `allowUnsignedWebhooks` | `false` | Isolated local development only: accept webhooks without `appSecret` (logs a warning). |
| `selfId` | none | The Instagram account's own id (IGSID). A message whose sender is this id arrives with `fromMe: true`, so the bot never answers it. |
| `requestTimeoutMs` | `60000` | Time allowed for each Send API call (send, typing, mark seen); a slower call rejects with a `ProviderError`. |
| `apiVersion` | `'v26.0'` | Graph API version (`DEFAULT_GRAPH_API_VERSION` of `@botmesh/graph-core`). It follows the current version and moves in a minor release; pin it to stay on one. Any other shape than `vNN.N` fails in the constructor; `undefined` keeps the default. |
| `graphUrl` | `'https://graph.facebook.com'` | Graph base URL (a proxy or a local simulator). It must be an absolute `http(s)` URL; `undefined` keeps the default. |
| `mediaDownload` | HTTPS, public hosts | `secureFetch` policy for inbound attachments (`maxBytes`, `timeoutMs`, `allowHttp`…). |
| `mediaRefHosts` | Meta CDN hosts | Hosts whose attachment URLs may be journaled for durable replays (`BotConfig.durability`). |
| `logger` | pino at `error` | Any `LoggerLike` (pino, `console`…). |
| `debug` | `false` | **Deprecated**: pass a `logger` instead. |

## What it supports

| Feature | Instagram DM |
| --- | --- |
| Text | ✅ |
| Image, video, audio, document | ✅ by **public URL only** (the Send API takes no buffers or paths) |
| Media captions | ⚠️ sent as a text message right after the attachment (Instagram attachments carry no caption) |
| Buttons (`ctx.buttons`) | ✅ as **quick replies** (max 13, titles cut to 20 characters, unique ids and titles, a non-empty text) |
| Quick reply or postback tap → interaction (`kind: 'button'`, `data` is the button `id`) | ✅ |
| Lists | ⚠️ degraded to numbered text (Instagram has no lists) |
| Cards (`card`) | ⚠️ the text with its buttons as quick replies, then the image (`imageUrl`); an image-only card sends just the image |
| Inbound reactions (`kind: 'reaction'`) | ✅ |
| Typing and read receipts (`sender_action`) | ✅ |
| Inbound media download (`MediaRef.token` is the attachment URL) | ✅ |
| Several photos in one DM | ✅ one message per attachment: the first keeps the message id and the text, the others get `<mid>#2`, `<mid>#3`… |
| Text over 1000 UTF-8 bytes (`maxTextBytes`) | ✅ split by bytes into several messages by `@botmesh/core` (non-ASCII text fits less) |
| `ctx.sendNative('instagram', message)` | ✅ posts a Send API `message` object as is |
| Sending reactions, polls, location, contact, sticker, templates | ❌ `UnsupportedContentError` |
| Groups, presence, editing or deleting messages | ❌ (not in the API) |

- **Identity:** `chatId` and `senderId` are the sender's IGSID (Instagram-scoped user id), stable and opaque. The account's own messages arrive as echoes (`is_echo`) and are not emitted; a message the user unsends (`is_deleted`) is not emitted as a new one.
- **Media by public URL only:** upload files to public hosting and pass the URL (`'https://…'` or `{ url }`). A `Buffer`, a path or a stream rejects with `UnsupportedContentError`.
- **Captions and card images are extra messages:** the caption goes out as text after the attachment (split at 1000 bytes), and a card image after the card text (an image-only card sends just the image; a card with neither is rejected). The send result points at the attachment (caption) or the card text, which always goes out first; if that extra message fails, it is logged as a warning and the send still resolves, so a retry never sends the main message twice.
- **Replies are not threaded on send:** `options.quoted` is ignored.
- `acknowledgeInteraction()` is a no-op: quick replies need no ack.

## Errors you may see

Sends reject with the typed errors of `@botmesh/core` (mapping in [`@botmesh/graph-core`](https://www.npmjs.com/package/@botmesh/graph-core); `toInstagramError()` exposes it):

| Error | Typical cause | What to do |
| --- | --- | --- |
| `OutsideSessionWindowError` (subcode `2534022`) | Outside the messaging window allowed by Instagram's policy | Wait for the user to write again. |
| `RecipientUnreachableError` (code `551`, subcodes `2018001`/`2534014`) | The user does not exist or is unavailable | Stop sending to that id. |
| `RateLimitedError` (codes `4`/`613`) | Page or app rate limit | Wait `retryAfterMs`; `ctx` sends and `bot.broadcast()` already retry short waits. |
| `UnsupportedContentError` | Poll, reaction, location, contact, sticker, template, a non-`http(s)` media source, more than 13 quick replies, quick replies without text, with an empty title, a duplicate id or title (after the 20-character cut) or an id over 1000 characters | Use quick replies or text; host media and pass its URL; shorten or rename the options. |
| `ProviderError` (code `190`) | Wrong or expired Page token | Generate a new Page access token for the connected Page. |
| `ProviderError` ("timed out") | A Send API call took longer than `requestTimeoutMs` | Check connectivity to Graph, or raise the timeout. |
| Constructor error naming a field | `accessToken` or `verifyToken` empty, `appSecret` missing or blank, a malformed `apiVersion` or `graphUrl` | Check the environment variables. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Meta says the callback URL could not be verified | The `GET` route answered `403`: the `verify_token` set in Meta differs from `verifyToken`, or the route does not return `verifyChallenge(query)` as plain text. |
| Every webhook `POST` gets `403` | The signature check failed: `appSecret` is not the app's secret, or the body reached `ingest()` re-serialized (parse nothing before it; pass the raw bytes). See [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting#webhook-signature-mismatch-403). |
| Webhook `POST`s get `400` | The body is not a JSON object, or a parsed object was passed while `appSecret` is set. |
| Webhook `POST`s get `503` | The bot is stopped (`bot.stop()` without a new `bot.start()`). Meta retries the delivery. |
| The webhook verifies but no DM arrives | The Instagram account is not a professional account connected to the Page, "Allow access to messages" is off in the Instagram app's settings, or the app lacks `instagram_manage_messages`. |
| Sends fail with a permissions error | The token is not the connected Page's token, or the app is in development mode and the recipient has no role in it. |

## Internal entry

`@botmesh/instagram/internal` exports the Graph client and the wire helpers (`GraphClient`, `parseInbound`, `toOutbound`, `toOutboundParts`) for tooling and tests. It has **no semver guarantee**: any of them may change in a minor release. Applications only need `ingest()` and the bot.

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels#botmesh-instagram) · [Webhook server](https://andresayac.github.io/botmesh/guide/server) · [Local sandbox](https://andresayac.github.io/botmesh/guide/sandbox) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/instagram-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/instagram-provider) · [Issues](https://github.com/andresayac/botmesh/issues)
