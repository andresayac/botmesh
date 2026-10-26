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

This page lists every provider in the repository, how each one receives
events, and what it can and cannot do. Install the core plus the channel you
need:

```bash
pnpm add @botmesh/core @botmesh/baileys   # or @botmesh/meta, @botmesh/telegram, @botmesh/discord, @botmesh/twilio...
```

While botmesh is in prerelease, add the prerelease dist-tag to each package
(see [Getting started](/guide/getting-started)).

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
| `@botmesh/tiktok` | `tiktok-provider` | Not on npm yet | TikTok API for Business (comments + Business Messaging) |

The **On npm** channels are installed with `pnpm add` and follow semver
(during the beta, add the `@beta` dist-tag; those marked "from the beta" ship to
npm for the first time with it). `@botmesh/tiktok` has `"private": true` in its
`package.json`: it is implemented and tested, but it is **not published to npm**
and its API may still change. Use it from a clone of the monorepo (`"workspace:*"`).
The same goes for the [sandbox](/guide/sandbox). The webhook ingress,
[`@botmesh/server`](/guide/server), is on npm.

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
  WPPConnect, Twilio, Gupshup and HighLevel also reject a payload addressed to
  another provider id instead of posting it.

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
  channels share `toGraphError` from `@botmesh/graph-core`); the older `toProviderError`
  names remain as deprecated aliases. `ingest()` returns the HTTP status to answer with
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

### `@botmesh/baileys`

WhatsApp Web through [Baileys](https://github.com/WhiskeySockets/Baileys).
Links with a QR code (or a pairing code, `pairingPhoneNumber`) and keeps the session in
`sessionsDir` (`./sessions/<session>`): later starts reconnect without a QR. It
depends on the exact `@whiskeysockets/baileys` `7.0.0-rc14` (there is no stable
Baileys 7 yet); the README explains the pin and the upgrade policy.

```ts
import { BaileysProvider } from '@botmesh/baileys'

const provider = new BaileysProvider({ session: 'my-bot' })
```

- Socket owned by the provider, with reconnection and backoff
  (`reconnect: { maxAttempts, baseMs, capMs }` tunes it, `false` turns it
  off).
- LID and phone-number forms of a user are merged into one stable
  `senderId`.
- No native buttons or lists (WhatsApp Web dropped them): use `choose()`
  menus or `ctx.poll()`.
- Anti-ban send rate limiting is on by default (`rateLimit`).
- Reactions and deletes arrive as events, never as messages, so a
  catch-all handler or an open `ask` does not take them as text. A **text
  edit** arrives as a message with the new text and the original `ref.id`,
  like on Telegram: `isEditedMessage(ctx)` (from `@botmesh/baileys`) tells it
  apart, and `editedMessages: 'ignore'` drops edits. Only the author of a
  message this process has seen can edit it: an edit of someone else's
  message, of the bot's own or of an original no longer cached is dropped.
- `ctx.voice()` and `ctx.sticker()` accept URLs and streams (downloaded with
  the same SSRF checks as other media); `ctx.poll()` needs 2 to 12 unique
  options.

[README](https://github.com/andresayac/botmesh/tree/main/packages/baileys-provider)

### `@botmesh/meta` (WhatsApp Cloud API)

The official API. Webhook-based: GET handshake with `verifyChallenge()`,
POST events with `ingest()` (see the server example
[above](#socket-polling-or-webhook)).

Setup in Meta: create an app with the **WhatsApp** product on
developers.facebook.com, generate a permanent **system-user token** with
`whatsapp_business_messaging`, copy the sender's **phone number id**, then set
the webhook URL and a verify token of your choice under WhatsApp →
Configuration and subscribe it to the **`messages`** field (it carries both
messages and delivery statuses).

```ts
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,        // system-user token
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!, // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,     // verifies X-Hub-Signature-256
})
```

- Native reply buttons (max 3: more rejects with `UnsupportedContentError`,
  send a list instead), lists, templates and WhatsApp Flows forms. A button
  with `url` goes out as a `cta_url` link button (one per message: several
  links, or a link mixed with reply buttons, reject). A `card` keeps its
  image (as the media or the interactive header) and its buttons. Graph's
  limits are checked before sending: no buttons, repeated button ids or
  titles (compared after the 20-character cut), a list with no rows, more
  than 10 rows in total or repeated row ids reject with
  `UnsupportedContentError`. Labels are cut on grapheme boundaries, so an
  emoji is kept whole or dropped, never split.
- A missing `accessToken`, `phoneNumberId` or `verifyToken` fails at
  construction with an error naming the field (`phoneNumberId` may also be
  a safe integer). Every Graph request has a timeout (`requestTimeoutMs`,
  60 s by default); media uploads have their own (`uploadTimeoutMs`, 5 min
  by default).
- An interactive reply that is not a button or list press (for example
  `call_permission_reply`) arrives as an `unknown` message with the raw
  payload in `ctx.ref.native`.
- **Graph API version:** `apiVersion` defaults to `DEFAULT_GRAPH_API_VERSION`
  from `@botmesh/graph-core` (`v26.0`, released 2026-07-29; Messenger and
  Instagram use the same default). Meta retires each version about two years
  after its release, so the default follows the current one and moves in a
  minor release, after the payloads are checked against Meta's changelog. Pin
  `apiVersion` (for example `'v24.0'`) to stay on a version until you
  migrate. A `played` status (a voice note was listened to) is reported as
  `read` with `platformData.played: true`.
- Users with a WhatsApp username may arrive with a BSUID instead of a phone
  number; the provider keeps one stable id per person (`identityMap`).
- Outside the 24 h window free-form sends reject with
  `OutsideSessionWindowError`. The optional `sessionWindow` manager reopens
  the chat with a template and retries: see
  [24-hour window and pricing](/guide/session-window).
- No groups, typing or polls in the API, and no delete for everyone: the
  provider has no `typing()` or `deleteMessage()`, so `ctx.typing()` and
  `ctx.delete()` do nothing (see the [cross-channel contract](#cross-channel-contract)).
- Text over 4096 characters is split into several messages by the core.
- `publishForm()` bakes the default submit label of a form into the Flow in
  the provider's `lang` (default `'en'`; set it to your bot's `BotConfig.lang`),
  or in `publishForm(def, { lang })` for one Flow. A form's own `submitLabel`
  always wins.

[README](https://github.com/andresayac/botmesh/tree/main/packages/meta-provider)

### `@botmesh/telegram`

Telegram Bot API. Long polling by default; `polling: false` switches to
webhook mode, where `webhookSecret` is required.

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

[README](https://github.com/andresayac/botmesh/tree/main/packages/telegram-provider)

### `@botmesh/messenger`

Facebook Messenger through the Graph Send API, with the same webhook
verification as the Cloud API.

```ts
import { MessengerProvider } from '@botmesh/messenger'

const provider = new MessengerProvider({
  accessToken: process.env.FB_PAGE_TOKEN!, // Page access token (pages_messaging)
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Buttons and lists are native; reactions arrive but cannot be sent
  (subscribe the webhook to `message_reactions`; `emoji` is the character and
  `removed` is set on `unreact`).
- Text is capped at 2000 characters (`maxTextLength`): longer text is split
  into several messages, and `ctx.stream()` chunks fit the Send API.
- More than 3 buttons (button template) or 10 list rows (generic template)
  reject with `UnsupportedContentError` instead of dropping options.
- Each Send API call times out after `requestTimeoutMs` (60 s by default).
- No text is cut: a list sends its text before the generic template (which
  has no header), and button text past the template's 640 characters goes
  first as plain text.
- Several attachments in one message arrive as one message each (`<mid>`,
  `<mid>#2`…). An edited message (subscribe `message_edits`) arrives again
  with its original id; `isEditedMessage(ctx)` tells it apart.
- Message tags: `bot.send(psid, text, { platformData: { tag: 'HUMAN_AGENT' } })`
  sends after the 24-hour window (`messaging_type`, `notification_type` and
  `persona_id` are accepted too).

```bash
pnpm add @botmesh/core @botmesh/messenger
```

[README](https://github.com/andresayac/botmesh/tree/main/packages/messenger-provider)

### `@botmesh/instagram`

Instagram DMs of a professional account connected to a Facebook Page
(Messenger API for Instagram).

```ts
import { InstagramProvider } from '@botmesh/instagram'

const provider = new InstagramProvider({
  accessToken: process.env.META_PAGE_TOKEN!, // token of the connected Page
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Buttons go out as quick replies (at most 13, titles cut to 20 characters,
  unique ids and titles, attached to a non-empty text; anything else rejects
  with `UnsupportedContentError` instead of dropping options); lists degrade
  to numbered text. Every Send API request times out after
  `requestTimeoutMs` (60 s).
- DMs only (no groups); reactions arrive but cannot be sent.
- Text is capped at 1000 UTF-8 bytes (`maxTextBytes`, plus `maxTextLength`
  1000), so non-ASCII text fits less: longer text is split into several
  messages by bytes, and the `ctx.stream()` chunks fit too.
- Attachments carry no caption: a media caption goes out as a text message
  right after the attachment, and a card image after the card text (an
  image-only card sends just the image; one with neither is rejected).
- A DM with several photos arrives as one message per photo (ids `<mid>`,
  `<mid>#2`, `<mid>#3`…).
- While the bot is stopped, `ingest()` answers `503`, so Meta redelivers the
  webhook after the restart.

```bash
pnpm add @botmesh/core @botmesh/instagram
```

[README](https://github.com/andresayac/botmesh/tree/main/packages/instagram-provider)

### `@botmesh/discord`

Discord gateway (WebSocket) for events plus REST for sending.

```ts
import { DiscordProvider, GatewayIntents } from '@botmesh/discord'

const provider = new DiscordProvider({ token: process.env.DISCORD_TOKEN! })
// Default intents: Guilds | GuildMessages | MessageContent.
// Add GatewayIntents.DirectMessages to the `intents` bitmask to receive DMs.
```

- Buttons, select menus, polls, reactions and edits are native;
  `ctx.stream()` edits one message as the text grows.
- The bot keeps one reaction per message, like WhatsApp/Telegram: a new
  `ctx.react(emoji)` replaces its previous one and `ctx.react('')` removes it.
  Discord deletes reactions by emoji, so the provider remembers the emoji it
  set (in memory, `reactionMemory`, default 1000 messages); an unknown one
  (set before a restart, or evicted) rejects with `UnsupportedContentError`.
- Interactions have a hard acknowledgement deadline
  (`interactionsRequireAck`), so the core acknowledges each one exactly once
  for you: a deferred ack before the handler's first send, shortly before the
  ~3 s deadline, or when the handler ends, whichever comes first. Call
  `ctx.acknowledge('text')` before replying to answer with an immediate text
  instead; once the automatic ack went out, `ctx.acknowledge('text')` sends
  `text` as a normal reply and `ctx.acknowledge()` does nothing.
- `ctx.interaction.id` is the bare interaction id: its token stays inside the
  provider. As a backstop, the provider also defers any interaction still
  unanswered after `autoAcknowledgeMs` (default 2000 ms; `false` turns it off). A late `ctx.acknowledge('text')` after the ack goes
  out as a followup, with `appId` or else the application id Discord sends on
  READY and on each interaction; if none is known the call rejects with
  `ProviderError` instead of dropping the text.
- More than 25 buttons (5 rows of 5), 25 select-menu options or 10 poll
  answers reject with `UnsupportedContentError` instead of dropping options;
  text over 2000 characters is split into several messages.
- Each REST call times out after `requestTimeoutMs` (60 s by default); file
  uploads after `uploadTimeoutMs` (5 min).
- System messages (member joins, pins, boosts...) and messages from bots are
  not routed.
- A forwarded message carries the forwarded text and media (from its
  snapshot), not a quoted reply; one with nothing readable arrives as
  `unknown`. A native poll arrives as `type: 'poll'` with its question as body.
- **Edited messages** (`MESSAGE_UPDATE` with `edited_timestamp`) arrive as
  messages with the new text and the original `ref.id`; `isEditedMessage(ctx)`
  from `@botmesh/discord` tells them apart and `editedMessages: 'ignore'` drops
  them. Other updates (embed unfurls, pins, flags) are not routed: the provider
  delivers an edit once per `edited_timestamp` (it remembers the last one for
  the 1000 most recently edited messages), so pinning an edited message does not
  re-deliver it.

[README](https://github.com/andresayac/botmesh/tree/main/packages/discord-provider)

### `@botmesh/evolution`

[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2, a
self-hosted WhatsApp REST gateway built on Baileys. Outbound: REST with the
`apikey` header. Inbound: the instance webhook, authenticated with a shared
secret header or Evolution's `jwt_key` (HS256 JWT).

```bash
pnpm add @botmesh/core @botmesh/evolution   # during the beta: @beta on both
```

```ts
import { EvolutionProvider } from '@botmesh/evolution'

const provider = new EvolutionProvider({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.EVOLUTION_API_KEY!,
  instance: 'my-instance',
  webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET!, // or webhookJwtKey
})
// POST /webhook/evolution → res.sendStatus(provider.ingest(body, headers))
```

- `start()` checks the instance; when it is not paired, the QR or pairing
  code arrives in the `connection` update (`authPayload`).
- LID/PN twins sent by Evolution are reconciled before emitting; pass
  `identityPersistence` to keep ids stable across restarts.
- Polls, reactions, edits (text), typing and read receipts; buttons, lists
  and cards degrade to numbered text; `template` is rejected, and so is a
  poll WhatsApp cannot carry (fewer than 2 or more than 12 options, empty or
  repeated ones).
- If Evolution stops offering QR codes before the number is paired
  (`QRCODE_LIMIT`), the `connection` update is `closed` with reason
  `sessionInvalid`: call `start()` again for a new QR.
- Keep the instance webhook's `webhookByEvents` off: with it, Evolution adds
  the event name to the URL and an exact-path route answers 404.

[README](https://github.com/andresayac/botmesh/tree/main/packages/evolution-provider)

### `@botmesh/wppconnect`

[WPPConnect Server](https://github.com/wppconnect-team/wppconnect-server),
a self-hosted gateway on WhatsApp Web (WA-JS). REST with a Bearer token;
webhooks authenticated with a token in the webhook URL.

```bash
pnpm add @botmesh/core @botmesh/wppconnect   # during the beta: @beta on both
```

```ts
import { WPPConnectProvider } from '@botmesh/wppconnect'

const provider = new WPPConnectProvider({
  baseUrl: 'http://localhost:21465',
  session: 'my-bot',
  secretKey: process.env.WPP_SECRET_KEY!,       // or token: '<generated bearer>'
  webhookToken: process.env.WPP_WEBHOOK_TOKEN!, // webhook URL: …/webhooks/wpp?token=<it>
})
// POST /webhooks/wpp → res.sendStatus(await provider.ingest(body, headers, req.originalUrl))
```

- `ingest()` is **async** and takes the request URL as third argument,
  because wppconnect-server cannot add headers: the token travels in the
  query string.
- Unknown LIDs are resolved to phone numbers (`contact/pn-lid`) before
  emitting.
- `markRead` marks the whole chat as seen; buttons and lists degrade to
  numbered text.
- The connection follows the server's `status-find` webhooks: `isLogged` /
  `qrReadSuccess` → `ready`, `notLogged` and `qrcode` → `authenticating`,
  unlinking the device from the phone (`disconnectedMobile`) → `closed`
  with `sessionInvalid`. `bot.stop()` does not close the session on the
  server.

[README](https://github.com/andresayac/botmesh/tree/main/packages/wppconnect-provider)

### `@botmesh/twilio`

Twilio Programmable Messaging: **WhatsApp and SMS/MMS** with one class.
Webhooks verified with `X-Twilio-Signature`, which covers the exact public
URL.

```ts
import { TwilioProvider } from '@botmesh/twilio'

const provider = new TwilioProvider({
  accountSid: process.env.TWILIO_SID!,
  authToken: process.env.TWILIO_TOKEN!,           // signs webhooks + REST auth
  whatsappFrom: 'whatsapp:+14155238886',
  smsFrom: '+15017122661',
  webhookUrl: 'https://bot.example.com/twilio/webhook', // EXACT URL set in Twilio
})
```

- `chatId` is Twilio's `From` as is (`whatsapp:+57…` or `+57…`): the same
  person on WhatsApp and SMS is two chats.
- Text up to 1600 characters; media only from public URLs; buttons and
  lists become numbered text; `template` maps to `ContentSid` +
  `ContentVariables`.
- `ingestRequest({ url, body, headers })` for per-request URLs
  (multi-tenant).
- Error 63016 maps to `OutsideSessionWindowError`.
- A message with several attachments (`NumMedia` > 1, up to 10) arrives as
  **one message per attachment**, in order: the first keeps the `MessageSid`
  and the text (`Body`); attachment `i` gets the id `MessageSid:i` and an
  empty body (unique ids, stable across webhook retries).

[README](https://github.com/andresayac/botmesh/tree/main/packages/twilio-provider)

### `@botmesh/gohighlevel`

HighLevel (GoHighLevel / LeadConnector) Conversations API. Inbound through
the `InboundMessage` webhook (Ed25519 `X-GHL-Signature`), outbound with
`POST /conversations/messages` on the channel the contact last used.

```ts
import { GoHighLevelProvider } from '@botmesh/gohighlevel'

const provider = new GoHighLevelProvider({
  accessToken: process.env.GHL_TOKEN!,         // Private Integration Token
  locationId: process.env.GHL_LOCATION_ID!,
  // defaultChannel: 'SMS',                    // until the contact writes
})
```

- `chatId` = HighLevel `contactId`: one chat per contact across channels;
  the channel of each message is in `ctx.chat.platformData.channel`.
- HighLevel's public key is bundled (`GHL_WEBHOOK_PUBLIC_KEY`), so no
  webhook secret is needed. `ingest()` needs the **raw** body.
- Media only from public URLs; `template` maps to `templateId`.

[README](https://github.com/andresayac/botmesh/tree/main/packages/gohighlevel-provider)

### `@botmesh/gupshup`

Gupshup WhatsApp API: v1 send endpoints, v2 callbacks. Gupshup does not sign
callbacks, so they are authenticated with a shared token in the callback URL
(or a header).

```ts
import { GupshupProvider } from '@botmesh/gupshup'

const provider = new GupshupProvider({
  apiKey: process.env.GUPSHUP_API_KEY!,
  appName: 'MyBotApp',
  source: '917834811114',                          // the app's number
  webhookToken: process.env.GUPSHUP_WEBHOOK_TOKEN!, // callback: …/gupshup?token=<it>
})
// POST /gupshup → res.sendStatus(provider.ingestRequest({ url: req.originalUrl, body, headers }))
```

- Buttons go out as quick replies (up to 3), then as a list (up to 10),
  then as numbered text; lists are native up to 10 rows. The list button of
  degraded buttons reads `listButtonText` (default `'Options'`, max 20
  characters; `'Opciones'` for a Spanish bot).
- `chatId` = the sender's phone digits (no `+`), exactly what the send API
  expects.
- Media only from public URLs. Gupshup also documents IP allow-listing: do
  both in production.

[README](https://github.com/andresayac/botmesh/tree/main/packages/gupshup-provider)

### `@botmesh/email`

Email: **IMAP IDLE** to receive and **SMTP** to reply. Each email thread is
a chat, so `ask()` flows continue when the customer replies to the email.
`imapflow` and `nodemailer` are optional peer dependencies loaded lazily.

```ts
import { EmailProvider } from '@botmesh/email'

const provider = new EmailProvider({
  address: 'support@acme.com',
  imap: { host: 'imap.example.com', user: 'support@acme.com', pass: process.env.IMAP_PASS! },
  smtp: { host: 'smtp.example.com', user: 'support@acme.com', pass: process.env.SMTP_PASS! },
})
```

- `threading: 'thread'` (default, one chat per thread) or `'sender'` (one
  chat per address); persist threads with `threadStore: cursorThreadStore(store)`.
  That store also keeps the mailbox UID cursor, so after a restart the bot
  resumes after the last message it processed and never redelivers mail
  (even with `markSeen: false`).
- Loop protection against auto-replies and mailing lists, bounce handling
  (`status: 'failed'` events, suppression of hard-bounced addresses).
- `From` is not authenticated by email itself: use
  `requireAuthentication: { authservId }` to accept only mail your MTA
  authenticated.
- Without IMAP, `ingest(rawMime)` accepts raw MIME from an inbound-mail
  webhook and resolves `{ status, accepted, reason? }`.
- A transport built from `smtp` is closed on `stop()` and rebuilt on the
  next send (pooled ones too); an injected `smtpTransport` is yours and
  `stop()` never closes it.

[README](https://github.com/andresayac/botmesh/tree/main/packages/email-provider)

### `@botmesh/tiktok` (not on npm yet)

TikTok API for Business (v1.3): **comments** on the account's own videos and
**direct messages** (Business Messaging API, approval required). Webhooks
verified with `TikTok-Signature`.

```ts
import { TikTokProvider } from '@botmesh/tiktok'

const provider = new TikTokProvider({
  accessToken: process.env.TIKTOK_TOKEN!,             // or an async refresh function
  businessId: process.env.TIKTOK_BUSINESS_ID!,        // open_id of the account
  appSecret: process.env.TIKTOK_APP_SECRET!,          // verifies TikTok-Signature
  selfUniqueIdentifier: process.env.TIKTOK_SELF_UID!, // required to receive comments
})
```

- Chats: `dm:<conversation_id>` (DM), `comment:<video_id>:<comment_id>`
  (comment thread, a group chat) and `hic:<comment_id>` (high-intent
  comment). `ctx.chat.platformData.surface` tells them apart.
- DMs: text (up to 6000 characters), images, Q&A cards for buttons (1 to
  3); comments: text replies up to 150 characters. Buttons or lists a Q&A
  card cannot hold (more than 3 options, URL buttons, titles over 40
  characters) and menus sent to a comment thread degrade to a numbered text
  menu, as on Baileys.
- The bot cannot start a conversation, and TikTok limits messages per 48 h
  window (`OutsideSessionWindowError`).

[README](https://github.com/andresayac/botmesh/tree/main/packages/tiktok-provider)

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
  `toDiscordError`, `toMessengerError`, `toInstagramError`, `toTikTokError`;
  `toEmailProviderError` → `toEmailError`; `@botmesh/meta`'s `toProviderError` →
  `toGraphError` from `@botmesh/graph-core`.

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
