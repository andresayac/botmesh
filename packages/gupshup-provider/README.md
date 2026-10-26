# @botmesh/gupshup

**Gupshup WhatsApp API** transport for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core): sending through `POST /wa/api/v1/msg` (and `/wa/api/v1/template/msg`) and receiving through callbacks in **v2 format**. No SDK: everything goes through [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http)'s `secureFetch` (timeouts, size limits, anti-SSRF).

## Install

```bash
pnpm add @botmesh/core @botmesh/gupshup
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build (or to none). Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/gupshup@beta` during the beta (`npm view @botmesh/gupshup dist-tags` lists the tags). Once stable, the plain command above works.

## Requirements

1. A WhatsApp app in Gupshup: **API key**, **app name** (`src.name`) and the app **number**.
2. A callback URL configured in the console with **v2 payload**, including a secret token in the query: `https://bot.example.com/gupshup?token=<secret>`.

Gupshup does **not sign** its callbacks: the provider authenticates them with that token (constant-time comparison). Gupshup also recommends restricting by IP; do both in production.

## Usage

```ts
import express from 'express'
import { Bot } from '@botmesh/core'
import { GupshupProvider } from '@botmesh/gupshup'

const provider = new GupshupProvider({
  apiKey: process.env.GUPSHUP_API_KEY!,
  appName: 'MyBotApp',
  source: '917834811114',
  webhookToken: process.env.GUPSHUP_WEBHOOK_TOKEN!,
})

const bot = new Bot({ provider })
bot.when('hello', (ctx) => ctx.buttons('What do you need?', [
  { id: 'balance', title: 'Balance' },
  { id: 'agent', title: 'Agent' },
]))
bot.when('balance', (ctx) => ctx.reply('Your balance is…'))
await bot.start()

const app = express()
app.post('/gupshup', express.raw({ type: '*/*' }), (req, res) => {
  res.sendStatus(provider.ingestRequest({ url: req.originalUrl, body: req.body, headers: req.headers }))
})
app.listen(3000)
```

- `ingestRequest` reads the token from the query (`webhookTokenParam`, `token` by default) or from the header; `ingest(body, headers)` only from the header (`webhookTokenHeader`, `x-webhook-token` by default).
- Responses: `200` accepted (also the empty validation ping), `400` invalid JSON, `401` missing or wrong token.
- `allowUnsignedWebhooks: true` disables the token (isolated local development only).

## Identity

`chatId` = `senderId` = `sender.phone` (digits with country code, no `+`), which is exactly the `destination` the send API expects. Inbound messages carry the WhatsApp id; outbound ones the Gupshup `messageId` (= `gsId` in callbacks), so statuses, reactions and quotes of bot messages link through `gsId`.

## Content

| Kind | Gupshup |
| --- | --- |
| `text` | `{ type: 'text' }` |
| `image` / `video` / `audio` / `voice` / `document` / `sticker` | `image` (`originalUrl`/`previewUrl`), `video`, `audio`, `file`, `sticker` (**public URL**) |
| `location` / `contact` | `location` / `contact` |
| `buttons` | `quick_reply` (≤ 3, `postbackText` = button `id`) → `list` (≤ 10, list button labelled `listButtonText`, default `'Options'`) → numbered text |
| `list` | interactive `list` (`postbackText` = row `id`; > 10 rows → numbered text) |
| `template` | `/template/msg` with `{ id: name, params: components }` (`components` = array of strings or `{ params }`) |
| `native` (`provider: 'gupshup'`) | `message` object as-is |

`platformData` in the send options overrides form fields (e.g. `{ source: '…' }` for another number).

Inbound: text, media (`ctx.media`, expiring URL `urlExpiry`), location, contact, quotes (`quoted`), `quick_reply`/`button_reply`/`list_reply` and template buttons → interactions (the `postbackText` arrives as `ctx.body`), reactions → `reaction` event, `message-event` → `status` (`enqueued`/`deleted` are discarded; `failed` carries `code` and `reason`).

## Errors

`429` → `RateLimitedError` · "not opted in / inactive / invalid destination" → `RecipientUnreachableError` · "24 hours" → `OutsideSessionWindowError` · size → `PayloadTooLargeError` · the rest → `GupshupApiError` (`status`). A `200` response with `status: 'error'` also rejects.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | required | Account API key (`apikey` header). |
| `appName` | required | Gupshup app name (`src.name`). |
| `source` | required | The app's WhatsApp number, digits with country code. |
| `webhookToken` | required (unless `allowUnsignedWebhooks`) | Shared secret that authenticates callbacks (constant-time comparison). |
| `webhookTokenParam` | `'token'` | Query parameter read by `ingestRequest()`. |
| `webhookTokenHeader` | `'x-webhook-token'` | Header read by `ingest()` and `ingestRequest()`. |
| `allowUnsignedWebhooks` | `false` | Accept callbacks without the token. Isolated local development only. |
| `listButtonText` | `'Options'` (`DEFAULT_LIST_BUTTON_TEXT`) | Label of the list button when 4–10 buttons go out as a list (max 20 characters; e.g. `'Opciones'`). |
| `baseUrl` | `https://api.gupshup.io` | API base (a proxy or a local simulator). |
| `http` | `@botmesh/http` defaults | `secureFetch` options for every request. |
| `selfId` | `source` | The bot's own id. |
| `logger` | pino, `error` level | Any `LoggerLike`. `debug: true` is deprecated: pass a logger. |

## Entries

- `@botmesh/gupshup`: `GupshupProvider`, `GupshupApiError`, `toGupshupError`,
  `DEFAULT_LIST_BUTTON_TEXT`, the config types and the v2 callback types
  (`GupshupCallback`, the shape of `ctx.raw`). Covered by semver.
- `@botmesh/gupshup/internal`: the callback parser and the outbound mapper, for tests
  and custom tooling. **No semver**: they may change in any release.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every callback is answered `401` | The token is missing or different: register the callback URL with `?token=<webhookToken>` and pass the full request URL to `ingestRequest({ url })`, or forward the token in `webhookTokenHeader`. |
| Callbacks answered `400` | The body is not the raw JSON Gupshup sent: mount the route with `express.raw`. Also check that the app sends **v2** payloads. |
| Nothing reaches the bot, no errors | The callback URL in the Gupshup console points elsewhere, or the empty validation ping was the only request (it is answered `200` and ignored). |
| Sends reject with `OutsideSessionWindowError` | WhatsApp's 24-hour window closed: send an approved template (`kind: 'template'`). |
| Sends reject with `RecipientUnreachableError` | The user has not opted in or the number is not on WhatsApp. |
| A media send rejects with `UnsupportedContentError` | Gupshup only takes media by **public URL**. |

## Notes

- Timestamps are epoch **milliseconds**.
- ESM only, Node.js 22 or later.

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels#botmesh-gupshup) · [Session window](https://andresayac.github.io/botmesh/guide/session-window) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/gupshup-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/gupshup-provider) · [Issues](https://github.com/andresayac/botmesh/issues)
