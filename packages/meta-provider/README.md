# @botmesh/meta

The **official WhatsApp Cloud API (Meta)** transport for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core). Unlike WhatsApp Web clients such as Baileys, it is Meta's supported API: no risk of a ban for using an unofficial client, plus **native buttons, lists, templates and WhatsApp Flows forms**. It is webhook-based: your server receives Meta's webhook and hands it to the provider (no socket, no QR).

## Install

```bash
pnpm add @botmesh/core @botmesh/meta
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older alpha. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/meta@beta` during the beta (`npm view @botmesh/core dist-tags` lists the tags). Once stable, the plain command above works.

Nothing else to install: Graph calls use Node.js 22's native `fetch` and `crypto`, and inbound media is downloaded through the SSRF-safe [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http) (a dependency).

## Requirements (Meta)

1. An app on [developers.facebook.com](https://developers.facebook.com) with the **WhatsApp** product.
2. A **permanent access token** (system user) with `whatsapp_business_messaging` (add `whatsapp_business_management` to publish Flows). The temporary token of the API Setup page expires after 24 hours.
3. The **phone number id** of your sender number (API Setup page; not the phone number itself).
4. The app's **app secret** (App settings → Basic): it verifies every webhook.
5. A public **HTTPS webhook** pointing at your server: under WhatsApp → Configuration, set its URL and a `verify_token` you choose, and subscribe it to the **`messages`** field (messages and delivery statuses both arrive there).

## Usage

```ts
import { Bot } from '@botmesh/core'
import { CloudAPIProvider, type ChallengeQuery } from '@botmesh/meta'
import express from 'express'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!,     // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,         // required: verifies X-Hub-Signature-256
})

const bot = new Bot({ provider })
bot.when('hi', (ctx) => ctx.reply('👋 Hello from the official API!'))
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

The same two routes work in any framework: answer the `GET` with `verifyChallenge(query)` and hand the raw `POST` body and headers to `ingest()`, which does not wait for your handlers.

The recommended way to serve them is [`@botmesh/server`](https://andresayac.github.io/botmesh/guide/server) (`pnpm add @botmesh/server`): it keeps the raw bytes, answers the handshake, enforces body-size, time and concurrency limits and adds `/healthz` and `/readyz`, for `node:http`, Express, Fastify and Hono:

```ts
import { createIngress } from '@botmesh/server'
import { expressIngress } from '@botmesh/server/express'

app.use(expressIngress(createIngress({ routes: [{ path: '/webhook', provider }], bot }))) // before express.json()
```

`ingest(body, headers)` returns the HTTP status to answer with and never throws: `200` accepted, `400` for a body that is not a JSON object (or one already parsed while `appSecret` is set), `403` for a bad signature, `503` while the provider is stopped (after `bot.stop()`, until the next `bot.start()`), so Meta delivers the webhook again later instead of it being lost.

> **Webhook signature.** `appSecret` is required: `ingest` checks `X-Hub-Signature-256` (constant-time
> HMAC-SHA256 over the raw bytes) and rejects forged bodies with `403`. If every webhook gets `403`, the body was
> parsed before reaching `ingest` or the app secret is wrong (see
> [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting#webhook-signature-mismatch-403)).
> Only for local development can you opt out explicitly with `allowUnsignedWebhooks: true`.

## Configuration checks and timeouts

The constructor fails fast, naming the field (never its value), when `accessToken`, `phoneNumberId` or
`verifyToken` is missing or empty: a typo in an environment variable surfaces at startup instead of as a Graph
`401` or a webhook that never verifies. `phoneNumberId` may also be given as a safe integer. Every Graph request
(send, mark read, media lookup) has a timeout, `requestTimeoutMs` (default `60000`); a request that takes longer
rejects with a `ProviderError`. Media uploads (up to 100 MB) use `uploadTimeoutMs` (default `300000`, or
`requestTimeoutMs` when larger). The media CDN download has its own `mediaDownload.timeoutMs` (default 15 s).

```ts
const provider = new CloudAPIProvider({ /* ... */ requestTimeoutMs: 20_000 })
```

**Deprecated exports** (to be removed in the next major): `toProviderError` (use `toGraphError` from `@botmesh/graph-core`),
`GraphClient` (transport internals), the re-exported `verifyChallenge` / `verifySignature` (use
`provider.verifyChallenge(query)` and `provider.ingest()`, or import them from `@botmesh/graph-core`) and the `debug`
option (pass a `logger`).

**Graph API version.** `apiVersion` defaults to `DEFAULT_GRAPH_API_VERSION` from `@botmesh/graph-core`, currently
`'v26.0'` (released 2026-07-29). Meta retires each Graph version about two years after its release, so the default
follows the current version and moves in a minor release, after the webhook and send payloads are checked against
Meta's changelog. Pin it to stay on a version until you migrate:

```ts
const provider = new CloudAPIProvider({ /* ... */ apiVersion: 'v24.0' })
```

## What it supports

| Feature | Cloud API |
|---|---|
| Text, image, video, audio, document, sticker, location, contact | ✅ (when you upload a `Buffer`, the MIME type comes from the document's `mimetype`, the extension, the bytes or the content type; never `application/octet-stream` for image, audio, video or sticker) |
| **Reply buttons** (`ctx.buttons`, max 3; more rejects with `UnsupportedContentError` instead of dropping options, so send a list) | ✅ native (titles cut to 20 characters, never inside an emoji) |
| **URL button** (a `Button` with `url`) | ✅ native `cta_url` (one per message, label cut to 20 characters; several links, or a link mixed with reply buttons, reject with `UnsupportedContentError`) |
| **Cards** (kind `card`) | ✅ text, or an image with the title and body as caption; with buttons, an interactive message with the image as header (same button rules as above: nothing is dropped) |
| **Lists** (list `OutboundContent`) | ✅ native |
| **Templates** (kind `template`, e.g. outside the 24h window) | ✅ |
| Reactions, read receipts | ✅ |
| Users with a WhatsApp **username** (BSUID): receive and send | ✅ (see [Usernames and BSUID](#usernames-and-bsuid)) |
| Button/list clicks → interactions (`type: 'buttons'` + `ctx.acknowledge`) | ✅ |
| Quick-reply buttons of **templates** (`type: 'button'`) → interaction with the `payload` | ✅ |
| Replies quoting a message → `ctx.quoted.ref.id` (the quoted `wamid`) | ✅ |
| **Forms** (`flow().form()` → static WhatsApp Flows) | ✅ native (see [WhatsApp Flows](#whatsapp-flows-forms)) |
| Polls | ❌ (Graph 131051 — use buttons or WhatsApp Flows) |
| Groups, typing/presence, editing/deleting messages | ❌ (does not exist in the API; the provider has no `typing()`/`deleteMessage()`, so `ctx.typing()`/`ctx.delete()` do nothing) |
| Text over 4096 characters (`maxTextLength`) | ✅ split into several messages by `@botmesh/core` |

## WhatsApp Flows (forms)

The core's `flow().form(definition)` is sent here as a native **WhatsApp Flow** (`capabilities.forms === 'native'`). The provider compiles the definition into a static single-screen Flow JSON (`navigate`, no endpoint, no encryption) and the answer (`nfm_reply`) comes back as a `'form'` message that the step stores, validated, in `c.state`.

A Flow must exist in Meta before it can be sent:

```ts
import { writeFileSync } from 'node:fs'
import { CloudAPIProvider, toFlowJson } from '@botmesh/meta'

const provider = new CloudAPIProvider({ ...cfg, wabaId: process.env.WABA_ID, flows: { signup: '1234567890' } })
// or create it once from the bot (Flows API, token with whatsapp_business_management):
const { flowId } = await provider.publishForm(signup, { categories: ['SIGN_UP'] })   // keep flowId for config.flows
// or export the JSON to paste it into WhatsApp Manager:
writeFileSync('signup.flow.json', JSON.stringify(toFlowJson(signup), null, 2))
```

`signup` is the same `FormDefinition` you pass to `flow().form(signup)`; see the [Forms guide](https://andresayac.github.io/botmesh/guide/forms).

If a form has no associated Flow (neither `config.flows` nor `.form(def, { nativeId })`), the step asks field by field like on any other channel. `flowJsonWarnings(def)` warns about labels WhatsApp will truncate. The button (`cta`) and the message body follow the user's `ctx.lang` (`core.form.*` catalogue); the submit label stays fixed in the published Flow, so pick its language with `toFlowJson(def, { lang: 'es' })`, the provider's `lang` option for every `publishForm()` (`new CloudAPIProvider({ ..., lang: 'es' })`, the same value as your `BotConfig.lang`) or `publishForm(def, { lang: 'es' })` for one Flow (default `'en'`, the core default locale), or define `submitLabel`. Flows with an endpoint (`data_exchange`, encrypted dynamic screens) are not supported yet.

## Templates

A template is the `template` content kind. Create and approve it in WhatsApp Manager first, then send it with its name, language and the Graph `components` (parameters):

```ts
await bot.send('573001112233', {
  kind: 'template',
  name: 'order_update',
  language: 'en',
  components: [{ type: 'body', parameters: [{ type: 'text', text: 'A-1042' }] }],
})
```

A quick-reply button of a template comes back as an interaction whose `data` is the button's `payload`.

## 24-hour window

Outside the 24 hours since the user's last message, Meta only allows **templates**. A free-form send rejects with `OutsideSessionWindowError` (code 131047): send a template instead. The [24-hour window guide](https://andresayac.github.io/botmesh/guide/session-window) covers the manager below in detail.

With `sessionWindow` the provider handles it on its own: it stores the time of the last inbound message of each chat, and when a free-form send fails with 131047 (or the window is already known to be closed) it sends an approved template to reopen the conversation, queues the original message and retries it when the user replies.

```ts
const provider = new CloudAPIProvider({
  /* ... */
  sessionWindow: {
    reopenTemplate: { kind: 'template', name: 'reopen_conversation', language: 'en' },
    reopenTemplateByKind: { document: { kind: 'template', name: 'document_ready', language: 'en' } },
    onReport: (r) => logger.info({ chatId: r.chatId, outcome: r.outcome }, 'session window'),
    // store: myRedisStore,          // SessionWindowStore (in memory and bounded by default)
    // onReopened: 'resolve',        // 'reject' by default → SessionWindowReopenedError
  },
})
await provider.sessionWindow!.isOpen('573001112233')
```

`send()` rejects with `SessionWindowReopenedError` (a subclass of `OutsideSessionWindowError`) when it reopens and queues; with `onReopened: 'resolve'` it returns the template send's result. The retry queue lives in memory and is bounded (`maxPendingPerChat`, `maxPendingChats`, `pendingTtlMs`); before handing it the content, the provider uploads the media once (buffer, path or `{ stream }`) and the queue only keeps the media id, so retries neither re-read an already-consumed stream nor retain bytes. The window is per business number + user: store keys carry the `phoneNumberId` as a prefix (`<phoneNumberId>:<chatId>`) and a `SessionWindowManager` shared by several providers gives each number its own view (`manager.forScope(phoneNumberId)`), with its own window, queue and sends. If the template itself fails (`reopen-failed`), `send()` rejects and the message is **not** queued. Concurrent sends to a closed chat share a single template, and a late 131047 for a message sent before the user's last reply does not close the window (the message is forwarded right away).

**API stability.** What an app configures and queries is public and covered by semver: `SessionWindowManager` (constructor, `forScope`, `state`, `isOpen`, `expiresAt`, `pending`, `clearPending`), `SessionWindowOptions`, the `SessionWindowStore` contract and `MemorySessionWindowStore`, the report and reopen types, `SessionWindowReopenedError` and the constants. The hooks the provider drives (`manager.send()`, `noteInbound()`, `noteFailedStatus()`) and their `RawSend` type are `@experimental` and may change in a minor release; send through the provider or the bot instead.

## Pricing

Every `status` event carries the normalized webhook `pricing` object in `platformData.pricing` (`billable`, `pricingModel` `PMP`/`CBP`, `category`, `type` — `regular`, `free_customer_service`, `free_entry_point`) and, when present, `platformData.conversation`. `provider.usage` aggregates per chat and per category (each message counts once):

```ts
const provider = new CloudAPIProvider({ /* ... */ usage: { rates: { marketing: 0.0125, utility: 0.0008 } } })
provider.usage!.forChat('573001112233') // { messages, billable, free, estimatedCost, byCategory }
provider.usage!.totals()
```

## Identity

`chatId`/`senderId` are the `wa_id` (E.164 phone without `+`) when known and, otherwise, the user's **BSUID** (see below). There is no LID/PN duality as in Baileys, but the phone can be missing: the provider resolves it before emitting the event so the same person always keeps the same id.

## Usernames and BSUID

Since April 2026 the Cloud API also identifies every user with a **BSUID** (*business-scoped user ID*): an id of your business portfolio shaped `US.13491208655302741918` (ISO country code + `.` + up to 128 alphanumerics). Linked portfolios also get a **parent BSUID** (`US.ENT.11815799212886844830`).

If a user enables a WhatsApp **username**, Meta **omits their phone** (`messages[].from`, `contacts[].wa_id`, `statuses[].recipient_id`) unless you wrote to or called them in the last 30 days or have them in your *contact book*. In that case the webhook only carries the BSUID (`from_user_id`, `contacts[].user_id`, `recipient_user_id`).

### How the id is chosen

For every message, interaction, reaction or delivery status:

1. If this session (the process lifetime) already emitted an id for that BSUID, parent BSUID or phone, it is **reused**.
2. Otherwise the **phone** when the webhook brings it.
3. Otherwise the phone **learned earlier** for that BSUID (via `identityMap`).
4. Otherwise the **BSUID**.

The provider learns the phone ↔ BSUID pair from any webhook that carries both (messages + `contacts`, delivery statuses). Consequences:

- A user first seen with a phone and later only with a BSUID **keeps the phone-based id**.
- A user first seen only with a BSUID who later shares their phone **keeps the BSUID for the session** (the ongoing conversation is not broken); the pair is stored, so the next session uses the phone.
- Delivery statuses (`sent`/`delivered`/`read`/`failed`) are resolved with the same rules, so they arrive with the same `chatId` as the conversation.
- If Meta changes the BSUID (`user_id_update` webhook) or the user changes number (`user_changed_number` / `user_changed_user_id` system message), the new ids are linked to the session id.
- An item with no usable id (or with malformed ids) is **dropped and logged** with `logger.warn` (no personal data); an event with an empty id is never emitted.

`senderInfo` keeps the available identity data:

| Field | Content |
|---|---|
| `senderInfo.username` | WhatsApp username, if the user enabled one |
| `senderInfo.platformData.phoneNumber` | phone (from the webhook or learned), if known |
| `senderInfo.platformData.bsuid` | BSUID |
| `senderInfo.platformData.parentBsuid` | parent BSUID, if any |
| `senderInfo.platformData.username` | username (same as above) |

### Sending to a BSUID

Nothing special to do: if the `chatId` is a BSUID (or a parent BSUID), the provider sends with the `recipient` field instead of `to`; if it is a phone, it keeps using `to`. `ctx.reply()` works the same with username users. You can check it with `isBsuid(chatId)`.

> *One-tap*, *zero-tap* and *copy code* authentication templates require a phone; sending them to a BSUID fails with Graph error `131062`.

### Persisting the phone ↔ BSUID pairs (`identityMap`)

By default the pairs are kept in an in-memory `MemoryIdentityMap` (LRU of 10,000 entries) and **are lost on restart**: after a restart, a user arriving only with a BSUID would get an id different from the phone they used before. To avoid it, pass your own `identityMap`. The interface is minimal and accepts synchronous or asynchronous methods:

```ts
interface IdentityMap {
  get(bsuid: string): string | undefined | Promise<string | undefined>  // → phone (wa_id)
  set(bsuid: string, phone: string): void | Promise<void>
}
```

With Redis (asynchronous):

```ts
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  // ...accessToken, phoneNumberId, verifyToken, appSecret
  identityMap: {
    get: async (bsuid) => (await redis.hGet('wa:bsuid', bsuid)) ?? undefined,
    set: async (bsuid, phone) => { await redis.hSet('wa:bsuid', bsuid, phone) },
  },
})
```

Or synchronous, preloading from your database and writing in the background:

```ts
import { CloudAPIProvider, MemoryIdentityMap } from '@botmesh/meta'

const memory = new MemoryIdentityMap({ maxEntries: 100_000, entries: await db.loadBsuidPairs() })
const provider = new CloudAPIProvider({
  // ...
  identityMap: {
    get: (bsuid) => memory.get(bsuid),
    set: (bsuid, phone) => { memory.set(bsuid, phone); void db.saveBsuidPair(bsuid, phone) },
  },
})
```

Details:

- With a synchronous map, `ingest()` emits the events right away. With an asynchronous one, `ingest()` still returns `200` immediately and the events are emitted when the lookup finishes, **always in webhook order**. `stop()` waits for that queue to drain.
- `get` is only queried for users that arrive without a phone and that the session does not know yet; `set` is called once per pair and session (make it idempotent).
- If `get` fails, the event is emitted with the BSUID and the error is logged; if `set` fails, it is only logged.
- `parseInbound(body)` (exported) is **stateless**: it resolves the identity inside that body. Continuity between webhooks is provided by `provider.ingest()`.

## Errors you may see

Sends reject with the typed errors of `@botmesh/core` (mapping in [`@botmesh/graph-core`](https://www.npmjs.com/package/@botmesh/graph-core#error-mapping)):

| Error | Typical cause | What to do |
|---|---|---|
| `OutsideSessionWindowError` (Graph `131047`) | More than 24 h since the user's last message | Send an approved template (`kind: 'template'`) or configure [`sessionWindow`](#24-hour-window). |
| `RecipientUnreachableError` (`131026`, `131030`) | The number cannot receive messages, or (test number) it is not in the allowed recipients list | Add the number to the test number's recipient list in the Meta dashboard. |
| `RateLimitedError` (`130429`, `131056`, `4`, `80007`…) | Throughput or pair rate limit | Wait `retryAfterMs`; `bot.broadcast()` and `ctx` sends already retry short waits. |
| `UnsupportedContentError` | Polls, more than 3 reply buttons, a link mixed with reply buttons, more than 10 list rows | Use a list, buttons or WhatsApp Flows instead. |
| `ProviderError` (`190`, "the access token is invalid or expired") | Expired or temporary access token | Use a permanent system-user token with `whatsapp_business_messaging`. |
| `ProviderError` (`100`/`33`, "check the configured phone number id") | Wrong `phoneNumberId`, or the token cannot reach it | Copy the **phone number id** (not the phone number) from the API setup page. |
| Constructor error naming a field | `accessToken`, `phoneNumberId` or `verifyToken` missing or empty | Check the environment variables. |

## Webhook setup problems

| Symptom | Cause and fix |
| --- | --- |
| Meta says the callback URL could not be verified | The `GET` route answered `403`: the `verify_token` set in Meta differs from `verifyToken`, or the route does not return `verifyChallenge(query)` as plain text. |
| Every webhook `POST` gets `403` | The signature check failed: `appSecret` is not the app's secret, or the body reached `ingest()` re-serialized (parse nothing before it; pass the raw bytes). |
| Webhook `POST`s get `400` | The body is not a JSON object, or a parsed object was passed while `appSecret` is set. |
| Webhook `POST`s get `503` | The bot is stopped (`bot.stop()` without a new `bot.start()`). Meta retries the delivery. |
| The webhook verifies but no message arrives | The app is not subscribed to the `messages` field, or the number is not linked to the app (WhatsApp → API Setup). |

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels) · [24-hour window](https://andresayac.github.io/botmesh/guide/session-window) · [Forms](https://andresayac.github.io/botmesh/guide/forms) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/meta-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/meta-provider) · [Issues](https://github.com/andresayac/botmesh/issues)
