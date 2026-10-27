# @botmesh/wppconnect

The [WPPConnect Server](https://github.com/wppconnect-team/wppconnect-server) transport for
[`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core). `wppconnect-server` exposes
WhatsApp Web (WA-JS) as a REST API; the bot talks to it over HTTP and receives events
through webhooks.

- **Outbound:** `POST {baseUrl}/api/{session}/<endpoint>` with
  `Authorization: Bearer <token>`, through `@botmesh/http`'s `secureFetch` (no
  redirect following). With `secretKey`, the token is generated on `start()` and
  regenerated once after a 401 (the `secretKey` never appears in errors).
- **Inbound:** webhooks (`onmessage`, `onack`, `onreactionmessage`,
  `incomingcall`, `onparticipantschanged`, `status-find`, `qrcode`) →
  `await provider.ingest(body, headers, url)`, with a mandatory token and a
  `session` check.
- **Stable identity:** unknown LIDs are resolved to their number with
  `GET /api/{session}/contact/pn-lid/{lid}` **before** emitting (with a cache), and
  `sender.phoneNumber` also links the pair. The same person always produces the
  same `senderId`.
- **Content:** text, image, video, audio, voice note, document, sticker,
  location, contact (vCard), poll, reaction; `buttons`/`list`/`card` degrade to
  numbered text; `native` for any `/api/{session}/` endpoint.
- **Actions:** media download (`download-media`), mark chat as read
  (`send-seen`), typing/recording, delete, edit text.
- **Typed errors:** `RecipientUnreachableError`, `RateLimitedError`,
  `PayloadTooLargeError`, `UnsupportedContentError`, `ProviderError`.

## Install

```bash
pnpm add @botmesh/core @botmesh/wppconnect
```

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

You also need a running `wppconnect-server` (tested with `wppconnect/server-cli:1.3.50`)
and a session paired with a WhatsApp number. Node.js 22 or later, ESM only.

## Quick example

```ts
import express from 'express'
import { Bot } from '@botmesh/core'
import { WPPConnectProvider } from '@botmesh/wppconnect'

const provider = new WPPConnectProvider({
  baseUrl: 'http://localhost:21465',
  session: 'my-bot',
  secretKey: process.env.WPP_SECRET_KEY!,     // or token: '<already generated bearer>'
  webhookToken: process.env.WPP_WEBHOOK_TOKEN!,
})

const bot = new Bot({ provider })
bot.when('hello', (ctx) => ctx.reply('Hello! 👋'))

const app = express()
app.post('/webhooks/wpp', express.json({ limit: '25mb' }), async (req, res) => {
  res.sendStatus(await provider.ingest(req.body, req.headers, req.originalUrl))
})
app.listen(3000)
await bot.start() // start-session + status-session → ready, or QR in authPayload
```

`wppconnect-server` neither signs webhooks nor allows custom headers, so
the token goes in the webhook URL (server configuration):

```json
{ "webhook": { "url": "https://bot.example.com/webhooks/wpp?token=<WPP_WEBHOOK_TOKEN>" } }
```

Pass the request URL (`req.originalUrl` is enough) as the third argument of
`ingest()`. If a proxy in front rewrites it, the token is also accepted in the
`x-webhook-token` header or as `Authorization: Bearer <token>`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl` | `http://localhost:21465` | wppconnect-server URL. |
| `session` | — | Session name. |
| `token` / `secretKey` | — | One of the two is required. |
| `webhookToken` | — | Webhook token (`token` query, header or Bearer). |
| `webhookTokenHeader` | `x-webhook-token` | Alternative header. |
| `webhookTokenParam` | `token` | Query parameter. |
| `allowUnsignedWebhooks` | `false` | Isolated local development only. |
| `startSession` | `true` | Calls `start-session` on `start()`. |
| `webhookUrl` | — | Per-session webhook sent in `start-session` (must be in the server's `allowedUrls`). |
| `resolveLid` | `true` | Resolve LIDs with `contact/pn-lid`. |
| `maxLidLookups` | `5` | Maximum `pn-lid` lookups per webhook (in parallel). |
| `lidLookupTimeoutMs` | `5000` | Timeout of each `pn-lid` lookup. |
| `lidRetryMs` | `300000` | Wait before retrying a LID whose lookup failed. |
| `selfId` | — | Own number (`573…@c.us`); when missing it is learned from the `to` of an inbound DM. |
| `http` | — | `allowHttp`, `allowPrivateHosts` (default `true`), `timeoutMs` (30 s), `maxBytes` (64 MiB), `resolver`, `fetch`. |
| `identityCacheSize` | `10000` | Maximum size of the LID↔PN map (LRU): a positive integer, or `Infinity` for no bound. |
| `identityPersistence` | — | Durable LID↔PN map (synchronous `get`/`set`). Without it, the canonical id of a contact first seen with the LID only may change after a restart. |
| `logger` | pino at `error` | Any `LoggerLike` (pino, `console`, ...). |

`ingest()` resolves to the HTTP code: `200` (accepted; also for another session or
unknown events), `401` (invalid token) or `400` (not a valid webhook).

Missing or invalid options (`session`, neither `token` nor `secretKey`, a `baseUrl`
without `http(s)://`, no `webhookToken`) throw a `TypeError` from the constructor.

## Error mapping

`toWppError` turns a wppconnect-server error response into a typed `@botmesh/core` error:

| Server answer | Error |
| --- | --- |
| 429 | `RateLimitedError` (`retryAfterMs` from `Retry-After`, 1 s by default) |
| 413 | `PayloadTooLargeError` |
| 401/403 | `ProviderError` "Unauthorized — check the WPPConnect token/secretKey" (with `secretKey`, the token is regenerated once first) |
| 404 `{ status: 'Disconnected' }` (session not started, waiting for the QR, or closed) | `ProviderError` "WPPConnect session is not connected: start it (bot.start()) and pair it…" |
| 4xx/5xx saying the number does not exist / is not on WhatsApp | `RecipientUnreachableError` |
| network failure | `ProviderError` naming the cause (`ECONNREFUSED`, `TIMEOUT`...), never the token |

A `template` send, a `contact` whose `phone` has no digits and a `location` outside
±90/±180 reject with `UnsupportedContentError` before any request. An HTML error page
(an unknown `native` endpoint answers `Cannot POST /api/...`) is reduced to its text; a
`generate-token` error shows the `secretKey` as `{secretKey}`.

## Notes

- Message ids are the WA-JS serialized ones
  (`false_573…@c.us_3EB0…`): they are the ones accepted by `send-reply`, `react-message`,
  `delete-message` and `download-media`.
- `markRead` marks the **whole chat** (`send-seen`); WhatsApp Web has no
  per-message read receipts.
- Connection states come from the `status-find` webhooks: `isLogged` (restored
  session) and `qrReadSuccess` (just paired) → `ready`; `notLogged` and `qrcode` →
  `authenticating`; `disconnectedMobile` (device unlinked from the phone),
  `qrReadFail`, `qrReadError` and `deleteToken` → `closed` with `sessionInvalid`;
  `browserClose`, `serverClose`, `autocloseCalled` and `phoneNotConnected` → `closed`
  (`transient`). `inChat` is ignored: an unpaired session sends it too.
- `stop()` only stops the provider; the session keeps running in wppconnect-server
  (close it with `POST /api/{session}/close-session` if you need to).
- `baseUrl` must be an absolute `http(s)://` URL (a value without scheme fails in
  the constructor). A wrong `secretKey` (the server answers 400 "The SECRET_KEY is
  incorrect") rejects `start()` with the *Unauthorized* hint and a
  `sessionInvalid` connection update.
- For WPPConnect buttons/lists use
  `ctx.sendNative('wppconnect', { endpoint: 'send-list-message', body: {...} })`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Webhooks never arrive | wppconnect-server only calls URLs in its allow list: add the full webhook URL (with `?token=...`) to `WEBHOOK_ALLOWED_URLS` / `webhook.allowedUrls`, and make sure the server can reach the bot (in Docker, `host.docker.internal`). |
| Every webhook is answered `401` | The token in the webhook URL differs from `webhookToken`, or `ingest()` did not get the request URL (third argument). |
| `start()` rejects with *Unauthorized* and the connection closes with `sessionInvalid` | Wrong `secretKey` (the server says "The SECRET_KEY is incorrect") or a revoked `token`. |
| No QR reaches the bot | Some `server-cli` releases (1.3.55) drop the QR callback of a session started through the REST API; `1.3.50` works. The QR is also shown in the server log. |
| The same contact gets a different `senderId` after a restart | Their first message came with an unresolved LID. Keep `resolveLid` on and pass `identityPersistence` backed by durable storage. |
| Sends fail with *WPPConnect session is not connected* | The session is not started, still waits for the QR scan, or was closed (the server answers `404 { status: 'Disconnected' }`). Start the bot and pair the number; after an unlink on the phone (`closed` / `sessionInvalid`), pair again. |
| `markRead` marks more than one message | WhatsApp Web has no per-message read receipts: `send-seen` marks the whole chat. |

## Status

Covered by unit and end-to-end tests with a fake server, and by an opt-in suite against a
real `wppconnect/server-cli:1.3.50` container (token generation, session start with the QR
delivered through an authenticated webhook, typed errors for an unpaired session and a
wrong secret key). Pairing a real number and the message round trip with WhatsApp are not
covered by the automated suites: try them on a test number before going to production.
WPPConnect and WhatsApp Web are unofficial; read the
[security guide](https://botmesh.afaya.com.co/guide/security) and WhatsApp's terms before using a personal number.

## Links

- [Channels guide](https://botmesh.afaya.com.co/guide/channels#@botmesh/wppconnect) · [Security](https://botmesh.afaya.com.co/guide/security) · [Troubleshooting](https://botmesh.afaya.com.co/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/wppconnect-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/wppconnect-provider) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver: a breaking change is a major version. The WA-JS wire
types (`WppMessage`, `WppSender`, `WppId`) are `@experimental`, and
`@botmesh/wppconnect/internal` (parser, outbound mapper) has no semver guarantee.
