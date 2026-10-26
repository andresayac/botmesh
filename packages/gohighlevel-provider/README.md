# @botmesh/gohighlevel

**HighLevel (GoHighLevel / LeadConnector) Conversations API** transport for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core). A bot that answers CRM contacts on the channel they used: **SMS, WhatsApp, Email, Facebook, Instagram, Live chat, GMB or a Custom provider**. Inbound through the `InboundMessage` webhook (signed with **Ed25519, `X-GHL-Signature`**), outbound through `POST /conversations/messages`. No SDK: every request goes through [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http)'s `secureFetch`.

## Install

```bash
pnpm add @botmesh/core @botmesh/gohighlevel
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build (or to none). Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/gohighlevel@beta` during the beta (`npm view @botmesh/gohighlevel dist-tags` lists the tags). Once stable, the plain command above works.

## Requirements

1. A **Private Integration Token** (or a location OAuth token) with `conversations` and `conversations/message` (write) permissions.
2. The sub-account `locationId`.
3. A Marketplace app (or integration) subscribed to the **`InboundMessage`** webhook pointing at your server.

## Usage

```ts
import express from 'express'
import { Bot } from '@botmesh/core'
import { GoHighLevelProvider } from '@botmesh/gohighlevel'

const provider = new GoHighLevelProvider({
  accessToken: process.env.GHL_TOKEN!,
  locationId: process.env.GHL_LOCATION_ID!,
  // apiVersion: '2021-04-15',   // Version header (default)
  // defaultChannel: 'SMS',      // channel when the contact has not written yet
})

const bot = new Bot({ provider })
bot.when('hello', (ctx) => ctx.reply('Hi! Writing to you from the CRM'))
await bot.start()

const app = express()
// RAW body: the Ed25519 signature is computed over the exact bytes.
app.post('/ghl/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  res.sendStatus(provider.ingest(req.body, req.headers))
})
app.listen(3000)
```

- HighLevel's Ed25519 public key ships built in (`GHL_WEBHOOK_PUBLIC_KEY`); `publicKey` overrides it if they rotate it. The legacy RSA signature (`X-WH-Signature`, retired on 2026-09-01) is only accepted when you pass `legacyPublicKey`.
- `ingest` responses: `200` accepted (also ignored events or events from another location), `400` unreadable or already parsed body, `401` missing or invalid signature.
- `allowUnsignedWebhooks: true` disables verification (isolated local development only).

## Identity

`chatId` = `senderId` = HighLevel **`contactId`**. HighLevel already merges phone, email and social profiles into one contact, so the same person is the same chat on any channel; each message's channel is in `ctx.chat.platformData.channel` and the bot replies on the last channel used. To force another: `provider.send(contactId, content, { platformData: { type: 'Email', subject: 'Your order' } })` (the other `platformData` fields are passed as-is into the API body).

## Content

| Kind | HighLevel |
| --- | --- |
| `text` | `message` (on `Email` also escaped `html`) |
| `image` / `video` / `document` / `audio` / `voice` | `attachments: [url]` (**public URL**) + caption in `message` |
| `buttons` / `list` | numbered text menu |
| `template` | `templateId` (= `name`) |
| `native` (`provider: 'gohighlevel'`) | body fields as-is |

Inbound: messages (with attachments as `ctx.media`), `CALL` calls → `call` event. `OutboundMessage` echoes and the rest of the CRM events are ignored. `ctx.markRead()` sets `unreadCount: 0` on the conversation. `options.quoted` → `replyMessageId`.

## Errors

`429` → `RateLimitedError` · `404` or 400/422 for DND/opt-out/nonexistent contact → `RecipientUnreachableError` · `413` → `PayloadTooLargeError` · the rest → `GoHighLevelApiError` (`status`).

## Options

| Option | Default | Description |
| --- | --- | --- |
| `accessToken` | required | Private Integration Token or location OAuth token (sent as Bearer). |
| `locationId` | required | Sub-account id. Webhooks for another location are acknowledged and dropped. |
| `defaultChannel` | `'SMS'` | Channel used to reply before the contact has written. |
| `apiVersion` | `'2021-04-15'` | `Version` header of the Conversations API. |
| `baseUrl` | `https://services.leadconnectorhq.com` | API base (a proxy or a local simulator). |
| `publicKey` | HighLevel's key (`GHL_WEBHOOK_PUBLIC_KEY`) | Ed25519 key (PEM) that verifies `X-GHL-Signature`; override only if HighLevel rotates it. |
| `legacyPublicKey` | — | RSA key for the retired `X-WH-Signature`; leave unset unless you still receive it. |
| `allowUnsignedWebhooks` | `false` | Accept webhooks without a signature. Isolated local development only. |
| `http` | `@botmesh/http` defaults | `secureFetch` options for every request. |
| `selfId` | — | The bot's own id (a HighLevel user id). |
| `logger` | pino, `error` level | Any `LoggerLike`. `debug: true` is deprecated: pass a logger. |

## Entries

- `@botmesh/gohighlevel`: `GoHighLevelProvider`, `GoHighLevelApiError`, `toGhlError`,
  `verifyGhlSignature`, `GHL_WEBHOOK_PUBLIC_KEY`, the config types and the webhook
  body type (`GhlWebhookBody`, the shape of `ctx.raw`). Covered by semver.
- `@botmesh/gohighlevel/internal`: the webhook parser and the outbound mapper, for tests
  and custom tooling. **No semver**: they may change in any release.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every webhook is answered `401` | The signature does not verify: pass the **raw** body (`express.raw`), never a parsed object. If HighLevel rotated its key, pass the new one as `publicKey`. |
| Webhooks answered `200` but nothing reaches the bot | The event is for another `locationId`, is an `OutboundMessage` echo, or is not an `InboundMessage`. Check the app's webhook subscriptions. |
| Sends reject with `ProviderError` 401/403 | The token lacks the `conversations` / `conversations/message` write scopes, or belongs to another location. |
| Sends reject with `RecipientUnreachableError` | The contact is in DND, opted out or does not exist. |
| The bot replies by SMS to a WhatsApp contact | The contact has not written yet in this process: set `defaultChannel`, or pass `platformData: { type: 'WhatsApp' }`. |
| A media send rejects with `UnsupportedContentError` | HighLevel only takes attachments by **public URL**. |

## Notes

- Timestamps are epoch **milliseconds**.
- ESM only, Node.js 22 or later.

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels#botmesh-gohighlevel) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/gohighlevel-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/gohighlevel-provider) · [Issues](https://github.com/andresayac/botmesh/issues)
