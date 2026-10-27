# Channels (providers)

The bot engine (`@botmesh/core`) does not know about any transport. A
**provider** connects it to one channel: it receives the channel's events,
turns them into neutral `InboundEvent`s and sends `OutboundContent` back. The
same flows, triggers and plugins run on every channel; only the constructor
changes.

```ts
import { Bot } from '@botmesh/core'

const bot = new Bot({ provider }) // any provider below
```

This page compares every provider in the repository: how each one receives
events and what it can and cannot do. Each channel has its own page with its
setup, options and limits (see [Providers](#providers)). Install the core plus
the channel you need:

```bash
pnpm add @botmesh/core @botmesh/baileys   # or @botmesh/meta, @botmesh/telegram, @botmesh/discord, @botmesh/twilio...
```

::: tip Try a channel without an account
The [platform sandbox](/guide/sandbox) runs your bot on the real Cloud API,
Telegram, Twilio, Discord and other providers against local simulators, and
the [terminal simulator](/guide/dev-simulator) lets you chat with it. Neither
needs an app, a phone number or a public URL.
:::

## Published and unpublished packages

| Package | Directory | Status | Transport |
| --- | --- | --- | --- |
| `@botmesh/baileys` | `baileys-provider` | On npm | WhatsApp Web (Baileys socket) |
| `@botmesh/meta` | `meta-provider` | On npm | WhatsApp Cloud API (official) |
| `@botmesh/telegram` | `telegram-provider` | On npm | Telegram Bot API |
| `@botmesh/messenger` | `messenger-provider` | On npm (from the beta) | Facebook Messenger (Send API) |
| `@botmesh/instagram` | `instagram-provider` | On npm (from the beta) | Instagram DMs (Messenger API for Instagram) |
| `@botmesh/discord` | `discord-provider` | On npm (from the beta) | Discord (gateway + REST) |
| `@botmesh/evolution` | `evolution-provider` | On npm (from the beta) | Evolution API v2 (self-hosted WhatsApp gateway) |
| `@botmesh/wppconnect` | `wppconnect-provider` | On npm (from the beta) | WPPConnect Server (self-hosted WhatsApp gateway) |
| `@botmesh/twilio` | `twilio-provider` | On npm (from the beta) | Twilio Programmable Messaging (WhatsApp + SMS/MMS) |
| `@botmesh/gohighlevel` | `gohighlevel-provider` | On npm (from the beta) | HighLevel (LeadConnector) Conversations API |
| `@botmesh/gupshup` | `gupshup-provider` | On npm (from the beta) | Gupshup WhatsApp API |
| `@botmesh/email` | `email-provider` | On npm (from the beta) | Email (IMAP IDLE + SMTP) |
| `@botmesh/tiktok` | `tiktok-provider` | Private (not on npm) | TikTok API for Business (comments + Business Messaging) |

`@botmesh/tiktok` is implemented and tested but private: it is not on npm and
its API may change. Release status, dist-tags and install commands for every
package are in [Packages and versions](/guide/packages).

## Choosing a channel

**WhatsApp** has several options:

- **`@botmesh/baileys`**: links the bot as a WhatsApp Web device (QR or
  pairing code) and opens its own socket. No public server or webhook,
  groups and polls work, no per-message cost. It is an **unofficial**
  client: automating an account can break WhatsApp's terms and get the
  number banned. Keep the [rate limiter](/guide/rate-limiting) on.
- **`@botmesh/meta`**: the official WhatsApp Cloud API. Native buttons,
  lists, templates and [WhatsApp Flows forms](/guide/forms), no ban risk.
  Needs a public HTTPS webhook, has no groups, and free-form messages only
  work inside the [24-hour customer-service window](/guide/session-window).
- **`@botmesh/evolution`** / **`@botmesh/wppconnect`**: you already run an
  Evolution API or WPPConnect Server. The bot talks to that gateway over
  REST and receives its webhooks. Both gateways drive WhatsApp Web, so the
  same caveats as Baileys apply (unofficial, no reliable native buttons).
  The shared pieces (REST client, media, LID/PN reconciliation) live in
  `@botmesh/wa-gateway-kit`, a public dependency of both; you install the
  channel, not the kit (unless you write a transport for another gateway).
- **`@botmesh/twilio`** / **`@botmesh/gupshup`**: you send WhatsApp through
  that provider's account. Templates are supported; Twilio also covers
  SMS/MMS with the same class.
- **`@botmesh/gohighlevel`**: the bot answers HighLevel CRM contacts on the
  channel they used (SMS, WhatsApp, Email, Facebook, Instagram, Live chat...).

**Other channels:** `@botmesh/telegram` (long polling by default, webhook
optional), `@botmesh/discord` (gateway socket), `@botmesh/messenger` and
`@botmesh/instagram` (Meta webhooks), `@botmesh/email` (each email thread is a
chat) and `@botmesh/tiktok` (comments on your own videos and DMs).

### Socket, polling or webhook

- **Socket / polling** (the provider opens the connection): Baileys,
  Discord, Telegram in polling mode, Email (IMAP IDLE). Nothing to expose to
  the internet.
- **Webhook** (`capabilities.pushIngress: true`): Cloud API, Messenger,
  Instagram, Telegram in webhook mode, Evolution, WPPConnect, Twilio,
  HighLevel, Gupshup, TikTok. **Your** HTTP server receives the POST and
  hands the **raw body** plus the headers to `provider.ingest()`, which
  verifies the signature or token and returns the HTTP status to answer.
  [`@botmesh/server`](/guide/server) does that wiring (raw body, size limits,
  timeouts, concurrency cap, health endpoints) for `node:http`, Express,
  Fastify and Hono.

The recommended way is `@botmesh/server` (`pnpm add @botmesh/server`): one
route per provider, and the `GET` handshake and the signed `POST`s are
handled for you:

```ts
import { createServer } from 'node:http'
import { createIngress, createNodeHandler } from '@botmesh/server'

const ingress = createIngress({ routes: [{ path: '/webhook', provider }], bot })
createServer(createNodeHandler(ingress)).listen(3000) // also /healthz and /readyz
```

Without it, a route in any framework is enough. Read the body **as bytes**
(the signature covers the exact bytes, so never pass a re-serialized JSON
object) and answer with the status `ingest()` returns:

```ts
import { createServer } from 'node:http'
import { Bot } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
const bot = new Bot({ provider })
await bot.start()

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/webhook') return void res.writeHead(404).end()
  if (req.method === 'GET') { // Meta's subscription handshake
    const challenge = provider.verifyChallenge(Object.fromEntries(url.searchParams))
    return void (challenge ? res.writeHead(200).end(challenge) : res.writeHead(403).end())
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      if ((size += chunk.length) > 1024 * 1024) return void res.writeHead(413).end() // 1 MiB cap
      chunks.push(chunk)
    }
  } catch {
    return void res.destroy() // client aborted mid-upload: drop it, never crash the process
  }
  res.writeHead(provider.ingest(Buffer.concat(chunks), req.headers)).end()
}).listen(3000)
```

The other webhook providers follow the same pattern: Messenger and Instagram
have the same `GET` handshake, Telegram has none, and the providers whose
authentication covers the URL take it as well (WPPConnect's async
`ingest(body, headers, url)`, `ingestRequest({ url, body, headers })` on
Twilio and Gupshup).
`ingest()` does not wait for your handlers, so the platform gets its answer
right away.

The constructor of every webhook provider (Telegram only in webhook mode)
**throws** when its webhook credential (app secret, auth token or shared
token) is missing, unless you pass `allowUnsignedWebhooks: true`, which is
meant only for isolated local development. HighLevel is the exception: its
signing public key is bundled.

## Capability matrix

Values come from each provider's `capabilities` declaration. A feature
marked "no" is **degraded, not broken**: buttons and lists become a numbered
text menu, `ctx.edit` sends a new message, `ctx.react` resolves
`{ skipped: true }`, `ctx.typing` is a no-op (see
[Messages & media](/guide/messages#support-per-transport)).

**Content.** What each channel can send natively.

| Provider | Buttons | Lists | Polls | Send reactions | Edit | Templates | Forms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baileys | no | no | yes | yes | no | no | field by field |
| Cloud API (`meta`) | yes | yes | no | yes | no | yes | native (WhatsApp Flows) |
| Telegram | yes | no (inline keyboard) | yes | yes | yes | no | field by field |
| Messenger | yes | yes | no | no | no | no | field by field |
| Instagram | yes (quick replies) | no | no | no | no | no | field by field |
| Discord | yes | yes | yes | yes | yes | no | field by field |
| Evolution | no | no | yes | yes | yes | no | field by field |
| WPPConnect | no | no | yes | yes | yes | no | field by field |
| Twilio | no | no | no | no | no | yes | field by field |
| HighLevel | no | no | no | no | no | yes | field by field |
| Gupshup | yes | yes | no | no | no | yes | field by field |
| Email | no | no | no | no | no | no | field by field |
| TikTok | yes (1 to 3, DMs; more → numbered text) | yes (up to 3 rows, DMs; more → numbered text) | no | no | no | no | field by field |

**Ingress and presence.** How events arrive and which presence hints work.

| Provider | Ingress | Typing | Read receipts | Groups | `ctx.stream` |
| --- | --- | --- | --- | --- | --- |
| Baileys | socket | yes | yes | yes | chunks |
| Cloud API (`meta`) | webhook | no | yes | no | chunks |
| Telegram | polling or webhook | yes | no | yes | draft |
| Messenger | webhook | yes | yes | no | chunks |
| Instagram | webhook | yes | yes | no | chunks |
| Discord | socket | yes | no | yes | edit |
| Evolution | webhook | yes | yes | yes | chunks |
| WPPConnect | webhook | yes | yes | yes | chunks |
| Twilio | webhook | yes (WhatsApp only) | no | no | chunks |
| HighLevel | webhook | no | yes | no | chunks |
| Gupshup | webhook | no | no | no | chunks |
| Email | IMAP IDLE (or `ingest()`) | no | no | no | chunks |
| TikTok | webhook | yes (DMs) | yes (DMs) | no | chunks |

- **Send reactions** only describes sending. Several providers still
  receive reactions as `reaction` events (Messenger, Instagram, Gupshup,
  TikTok...).
- **`ctx.stream`**: `draft` = native draft previews then one final message
  (Telegram private chats; edits elsewhere), `edit` = one message edited as
  the text grows, `chunks` = no live preview, sentence-sized messages with
  typing (`streaming: 'none'`). See [Streaming replies](/guide/streaming).
- **Forms**: `native` sends `flow().form()` as a WhatsApp Flow;
  `field by field` asks each field with text messages.
- **`textFormat`** (not a column): the text markup the channel renders, so
  Markdown producers such as `@botmesh/ai` can convert it. `'whatsapp'`
  (`*bold*`, `_italic_`, `~strike~`): Baileys, Cloud API, Evolution,
  WPPConnect, Gupshup. `'plain'` (no markup): Telegram (sent without
  `parse_mode`), Messenger, Instagram, TikTok. `'markdown'`: Discord. Not
  declared: Email. Providers that serve several channels decide per chat with
  the optional `textFormatFor(chatId)`, which wins over `capabilities.textFormat`
  and reaches handlers as `ctx.textFormat`: Twilio returns `'whatsapp'` for
  `whatsapp:` chats and `'plain'` for SMS; HighLevel follows the contact's
  reply channel (`'whatsapp'` for WhatsApp, `'plain'` for SMS, Email, FB, IG,
  Live chat, GMB and custom).
- **Templates** is the `template` content kind: Cloud API templates, Twilio
  Content Templates (`ContentSid`), HighLevel `templateId`, Gupshup templates.
  Other providers reject it with `UnsupportedContentError`.
- Every provider except Baileys accepts the `native` content kind
  (`ctx.sendNative('<provider id>', payload)`) as an escape hatch to the
  channel's own API, with a provider-specific payload. Baileys rejects it
  with `UnsupportedContentError`. Discord, Messenger, Instagram, Evolution,
  WPPConnect, Twilio, Gupshup, HighLevel, Email and TikTok also reject a payload
  addressed to another provider id instead of posting it.

## Cross-channel contract

The same rules hold on every channel, so a bot behaves the same wherever it runs.
Provider authors check them with the helpers of `@botmesh/core/testing`
(see [Testing](/guide/testing#provider-contracts)).

- **Timestamps are epoch milliseconds.** `ctx.timestamp`, `InboundMessage.timestamp`,
  `InboundInteraction.timestamp` and `DeliveryStatus.timestamp` are epoch ms on every
  channel. Transports that report seconds (WhatsApp, Telegram, the Cloud API) are
  multiplied by 1000; one that reports no time (Twilio) uses the receive time, never
  `0`. Telegram sends no press time for a button, so a callback query carries the
  receive time.
- **Long text is split.** Each channel declares its text limit and the core splits a
  longer `text` send into several messages (see
  [Messages](/guide/messages#long-text-is-split-automatically); `splitLongText: false`
  turns it off).
- **Unsupported operations are absent.** An operation the transport cannot perform is
  not implemented: the optional method (`typing`, `markRead`, `editMessage`,
  `deleteMessage`) is missing and its capability flag is `false`, so `ctx.typing()`,
  `ctx.markRead()` and `ctx.delete()` do nothing. A method that exists performs the
  operation or rejects; it is never a silent stand-in.
- **Presence hints are best-effort while disconnected.** `typing()` and `markRead()`
  resolve without contacting the transport while the provider's last connection state
  is not `'ready'` (before `start()` connected, while reconnecting, after `stop()`):
  no error, no queue, no later retry. The bot applies the same rule before calling
  them, logs the skipped hint at debug and counts it in `metrics().presenceSkipped`
  (`botmesh_presence_skipped_total` in `toPrometheus()`). Once connected, a transport
  failure still rejects. `assertPresenceWhileDisconnected()` checks a provider.
- **Too many options reject.** A transport that shows fewer buttons, rows or poll
  answers than you sent rejects with `UnsupportedContentError` (Cloud API, Messenger,
  Instagram, Discord), unless it has a documented degradation (numbered text on
  Baileys, Evolution, WPPConnect, Gupshup, TikTok).
- **A local media path that cannot be read** rejects with `UnsupportedContentError`
  (the fs error as `cause`), never a raw `ENOENT`.
- **Waits are bounded.** Every REST call has a timeout (`requestTimeoutMs` on the
  Cloud API, Telegram, Discord, Messenger and Instagram), and a `RateLimitedError`
  never asks for more than 24 h.
- **An edit keeps the original id.** Where the transport reports text edits (Baileys,
  Telegram `edited_message`, Discord `MESSAGE_UPDATE`), the edit arrives as a message
  with the new text and the original `ref.id`; each of those packages exports
  `isEditedMessage(ctx)` and an `editedMessages: 'ignore'` option. The core dedupe lets
  an edit through because its content changed, and drops a redelivery of the same edit.
- **Poll votes have one shape.** Baileys and Telegram emit each vote as a `'poll'` event
  (`bot.on('poll', (vote) => …)`): `vote.ref` is the poll message, `vote.senderId`
  the voter and `vote.options` the current tally of every option with its `voters`.
- **One naming scheme for low-level helpers.** Each provider's error mapper is
  `to<Channel>Error` (`toTelegramError`, `toDiscordError`, `toTwilioError`…; the Meta
  channels share `toGraphError` from `@botmesh/graph-core`). Telegram, TikTok and the
  Cloud API keep their older `toProviderError` (and Email its `toEmailProviderError`) as
  deprecated aliases; the channels first published in the beta have only the new names.
  `ingest()` returns the HTTP status to answer with
  (a `number`); WPPConnect returns it as a `Promise<number>` (it resolves unknown LIDs
  through the gateway before emitting, never waiting for your handlers) and email's `ingest()` takes a raw message, not a webhook, and returns
  an `EmailIngestResult`.

| Provider | `maxTextLength` | `maxTextBytes` |
| --- | --- | --- |
| Baileys, Evolution, WPPConnect | 65 536 | |
| Cloud API (`meta`), Gupshup | 4096 | |
| Telegram | 4096 | |
| Discord, Messenger | 2000 | |
| Instagram | 1000 | 1000 |
| Twilio | 1600 | |
| TikTok | 6000 (DMs; comment replies allow 150) | |
| HighLevel, Email | not declared (no split) | |

## Providers

Each channel has its own page with setup, options and limits.

### `@botmesh/baileys`

WhatsApp Web through Baileys: QR or pairing-code login, own socket, groups and polls. See [Baileys (WhatsApp Web)](/guide/baileys).

### `@botmesh/meta` (WhatsApp Cloud API)

The official WhatsApp Cloud API: native buttons, lists, templates and WhatsApp Flows forms over webhooks. See [WhatsApp Cloud API](/guide/whatsapp-cloud-api).

### `@botmesh/telegram`

Telegram Bot API, by long polling or webhook. See [Telegram](/guide/telegram).

### `@botmesh/messenger`

Facebook Messenger through the Graph Send API and Meta webhooks. See [Messenger](/guide/messenger).

### `@botmesh/instagram`

Instagram DMs of a professional account (Messenger API for Instagram). See [Instagram](/guide/instagram).

### `@botmesh/discord`

Discord gateway (WebSocket) for events plus REST for sending. See [Discord](/guide/discord).

### `@botmesh/evolution`

Evolution API v2, a self-hosted WhatsApp gateway: REST out, instance webhook in. See [Evolution API](/guide/evolution).

### `@botmesh/wppconnect`

WPPConnect Server, a self-hosted WhatsApp Web gateway: REST with a Bearer token, webhooks with a URL token. See [WPPConnect](/guide/wppconnect).

### `@botmesh/twilio`

Twilio Programmable Messaging: WhatsApp and SMS/MMS with one class. See [Twilio](/guide/twilio).

### `@botmesh/gohighlevel`

HighLevel (LeadConnector) Conversations API: answers CRM contacts on the channel they used. See [HighLevel (GoHighLevel)](/guide/gohighlevel).

### `@botmesh/gupshup`

Gupshup WhatsApp API, with callbacks authenticated by a shared token. See [Gupshup](/guide/gupshup).

### `@botmesh/email`

Email over IMAP IDLE and SMTP: each email thread is a chat. See [Email](/guide/email).

### `@botmesh/tiktok` (not on npm)

TikTok API for Business: comments on your own videos and direct messages. See [TikTok](/guide/tiktok).

## Upgrading from a 2.0 alpha

New bots can skip this section. If you ran a bot on an early 2.0 alpha, the
[cross-channel contract](#cross-channel-contract) changed some behaviour; the
per-package details are in [Upgrade notes: channels & plugins](/guide/upgrade-channels-plugins)
and [Migrating to the stable API](/guide/stable-migration).

::: details What changed on every channel

- **`ctx.timestamp` is epoch milliseconds everywhere.** Baileys, the Cloud API and
  `MockProvider` used to report epoch seconds. Drop any `* 1000` (`new Date(ctx.timestamp)`
  is now right). The same goes for `InboundMessage`, `InboundInteraction` and
  `DeliveryStatus` timestamps in custom hooks. A third-party provider that still emits
  seconds keeps working: the core converts a value below `1e12` for `ctx.timestamp` and
  the message log, but update it to emit ms (`assertInboundContract` flags it).
- **Telegram button presses** carry the receive time, not the date of the message that
  holds the keyboard.
- **No-op methods were removed**: `CloudAPIProvider#typing()` and `#deleteMessage()`,
  `TelegramProvider#markRead()` and `DiscordProvider#markRead()`. They did nothing;
  use `ctx.typing()`/`ctx.delete()`/`ctx.markRead()` (no-ops there) or
  `provider.typing?.(…)`.
- **Long text is split** into several messages instead of being rejected with
  `PayloadTooLargeError`. `new Bot({ splitLongText: false })` restores the old behaviour.
  `before('send')` hooks still run once per message (on the whole text, before the
  split); `after('send')` hooks run once per part.
- **Too many options reject** on Discord (over 25 buttons or menu options, over 10 poll
  answers), Messenger (over 3 buttons, over 10 list rows) and Instagram (over 13 quick
  replies) with `UnsupportedContentError`; they used to drop the extra options silently.
- **Discord defers unanswered interactions** after 2 s. `autoAcknowledgeMs: false`
  restores the old behaviour. A late `ctx.acknowledge('text')` then goes out as a
  followup; with no `appId` and no application id received from Discord it rejects.
- **`MockProvider`** reports `capabilities.typing` and `readReceipts` as `false` unless a
  `typing()`/`markRead()` method exists (they had no effect before either), and emits
  epoch-ms timestamps.
- **`RateLimitedError.retryAfterMs`** is capped at 24 h.
- **Telegram polls are sent non-anonymous** so their votes reach the bot as `'poll'`
  events. `new TelegramProvider({ anonymousPolls: true })` keeps anonymous polls.
- **Discord edits are delivered** as messages with the original `ref.id`; a handler
  that should not see them checks `isEditedMessage(ctx)` or sets
  `editedMessages: 'ignore'`.
- **Renamed helpers** (the old names are deprecated aliases until v3): Telegram
  `pollTimeout` (seconds) → `pollTimeoutMs`; `toProviderError` → `toTelegramError`,
  `toTikTokError`; `toEmailProviderError` → `toEmailError`; `@botmesh/meta`'s
  `toProviderError` → `toGraphError` from `@botmesh/graph-core`. Discord, Messenger and
  Instagram dropped their alpha `toProviderError` before their first npm release: use
  `toDiscordError`, `toMessengerError` and `toInstagramError`.

:::

## Next steps

- [Messages & media](/guide/messages): what each helper does on each
  transport.
- [Platform sandbox](/guide/sandbox): run a bot on the real providers against
  local simulators, without accounts.
- [Webhook server](/guide/server): mount webhook providers with
  `@botmesh/server`.
- [24-hour window and pricing](/guide/session-window): Cloud API session
  window and usage tracking.
- [Forms](/guide/forms): native WhatsApp Flows on the Cloud API, field by
  field elsewhere.
