# @botmesh/evolution

The [Evolution API](https://github.com/EvolutionAPI/evolution-api) v2 transport for
[`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core). Evolution is a self-hosted
WhatsApp REST gateway built on Baileys: the bot does not open the WhatsApp socket, it talks
to your Evolution server over HTTP and receives its webhooks.

- **Outbound:** `POST {baseUrl}/message/<endpoint>/{instance}` with the `apikey`
  header, always through `@botmesh/http`'s `secureFetch` (no redirect following).
- **Inbound:** Evolution webhooks → `provider.ingest(body, headers)`, with
  mandatory authentication (shared secret in a header or Evolution's HS256 `jwt_key`).
- **Stable identity:** the LID/PN twins Evolution attaches
  (`remoteJidAlt`, `senderPn`, `participantAlt`, `participantPn`, `senderLid`)
  are linked inside the provider; the same person always produces the same
  `senderId`, even when a later message arrives with the LID only.
- **Content:** text, image, video, audio, voice note, document, sticker,
  location, contact, poll, reaction; `buttons`/`list`/`card` degrade to
  numbered text; `native` for any `/message/*` endpoint.
- **Actions:** media download, mark as read, typing/recording,
  delete for everyone, edit text.
- **Typed errors:** `RecipientUnreachableError` (number without WhatsApp),
  `RateLimitedError` (429 + `Retry-After`), `PayloadTooLargeError` (413),
  `UnsupportedContentError` (`template`), `ProviderError` for the rest.

## Install

```bash
pnpm add @botmesh/core @botmesh/evolution
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older alpha. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/evolution@beta` during the beta (`npm view @botmesh/evolution dist-tags` lists the tags). Once stable, the plain command above works.

You also need a running Evolution API v2 server (tested with `v2.3.4`) and an instance
paired with a WhatsApp number. Node.js 22 or later, ESM only.

## Quick example

```ts
import express from 'express'
import { Bot } from '@botmesh/core'
import { EvolutionProvider } from '@botmesh/evolution'

const provider = new EvolutionProvider({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.EVOLUTION_API_KEY!,
  instance: 'my-instance',
  webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET!,
})

const bot = new Bot({ provider })
bot.when('hello', (ctx) => ctx.reply('Hello! 👋'))

const app = express()
// Raw body or JSON: ingest() accepts a string, Buffer or object.
app.post('/webhook/evolution', express.json({ limit: '25mb' }), (req, res) => {
  res.sendStatus(provider.ingest(req.body, req.headers))
})
app.listen(3000)
await bot.start() // connectionState → ready, or QR in `connection.update.authPayload`
```

Point the instance webhook at your route, with the secret in a header:

```bash
curl -X POST http://localhost:8080/webhook/set/my-instance \
  -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
  -d '{"webhook":{"enabled":true,"url":"https://bot.example.com/webhook/evolution",
       "headers":{"x-webhook-secret":"<EVOLUTION_WEBHOOK_SECRET>"},
       "events":["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE","QRCODE_UPDATED","CALL","GROUP_PARTICIPANTS_UPDATE"]}}'
```

Alternative: put `"headers": { "jwt_key": "<key>" }` in the webhook and
`webhookJwtKey: '<key>'` in the provider; Evolution then sends
`Authorization: Bearer <JWT>` (HS256, expires after 10 min) and `ingest()` verifies
the signature, expiry and the `app: 'evolution'` / `action: 'webhook'` claims.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl` | — | Evolution server URL. |
| `apiKey` | — | Global key or instance token (`apikey` header). |
| `instance` | — | Instance name. |
| `webhookSecret` | — | Shared secret (`x-webhook-secret` header or `Authorization: Bearer`). |
| `webhookSecretHeader` | `x-webhook-secret` | Header carrying the secret. |
| `webhookJwtKey` | — | Evolution webhook `jwt_key`. |
| `allowUnsignedWebhooks` | `false` | Isolated local development only. Without a secret or JWT, the constructor fails. |
| `selfId` | — | Own JID; when missing, it is read from `/instance/fetchInstances` or from `connection.update`. |
| `http` | — | `allowHttp` (by default yes when `baseUrl` is `http://`), `allowPrivateHosts` (default `true`: the gateway is usually local), `timeoutMs` (30 s), `maxBytes` (64 MiB), `resolver`, `fetch`. |
| `identityCacheSize` | `10000` | Maximum size of the LID↔PN map (LRU). |
| `identityPersistence` | — | Durable LID↔PN map (synchronous `get`/`set`). Without it, the canonical id of a contact first seen with the LID only may change after a restart. |
| `convertAudioToMp4` | `false` | Ask Evolution for audio as MP4 when downloading. |
| `logger` | pino at `error` | Any `LoggerLike` (pino, `console`, ...). |

Missing or invalid options (`baseUrl`, `apiKey`, `instance`, a `baseUrl` without
`http(s)://`, no webhook authentication) throw a `TypeError` from the constructor.

`ingest()` returns the HTTP code: `200` (accepted; also for another instance or
unknown events, so Evolution does not retry), `401` (invalid credential) or `400` (not an Evolution webhook).

## Supported events

| Webhook | Normalized event |
| --- | --- |
| `messages.upsert` | `message` (or `reaction` when it is a `reactionMessage`) |
| `messages.update` | `status` (`SERVER_ACK`→`sent`, `DELIVERY_ACK`→`delivered`, `READ`/`PLAYED`→`read`, `ERROR`→`failed`) |
| `connection.update` | `connection` (`open`→`ready`, `close` 401→`sessionInvalid`, 440→`sessionTakenOver`) |
| `qrcode.updated` | `connection` `authenticating` with the QR in `authPayload` |
| `call` | `call` |
| `group-participants.update` | `group` |

Names are accepted in any form (`MESSAGES_UPSERT`, `messages-upsert`,
`messages.upsert`, useful with `webhookByEvents`).

## Media

`ctx.media` / `provider.downloadMedia(ref)` uses the webhook base64 when the
instance has `webhookBase64: true`; otherwise it calls
`/chat/getBase64FromMediaMessage/{instance}`. It never downloads arbitrary URLs from the
payload. To send, a URL (`http(s)://` or `{ url }`) is passed to Evolution as-is
and any other `MediaSource` (Buffer, path, stream) travels as base64.

## Error mapping

`toEvolutionError` turns an Evolution error response into a typed `@botmesh/core` error:

| Evolution answer | Error |
| --- | --- |
| 429 | `RateLimitedError` (`retryAfterMs` from `Retry-After`, 1 s by default) |
| 413 | `PayloadTooLargeError` |
| 400/404 with `exists: false` (number not on WhatsApp) | `RecipientUnreachableError` |
| 401/403 | `ProviderError` "Unauthorized — check the Evolution apiKey" |
| 404 | `ProviderError` "Instance or resource not found" |
| network failure | `ProviderError` naming the cause (`ECONNREFUSED`, `TIMEOUT`...), never the API key |

A `template` send rejects with `UnsupportedContentError`.

## Limitations

- Native buttons and lists are unreliable on WhatsApp Web: they are sent as numbered
text. For Evolution's own, use
`ctx.sendNative('evolution', { endpoint: 'sendButtons', body: {...} })`.
- Poll votes (`pollUpdates`) are not emitted as `poll-vote` yet.
- If a person's first message arrives with the LID only and without a twin, that LID
  stays as their canonical id. Without `identityPersistence` the map lives in
  memory, so after a restart the same person may get the phone-number id instead.
- `baseUrl` must be an absolute `http(s)://` URL: `localhost:8080` (no scheme)
  fails in the constructor. Network failures name their cause
  (`ECONNREFUSED`, `TIMEOUT`...) in the `ProviderError` message.
- Sending through an instance that is not paired yet makes Evolution hold the
  request until `http.timeoutMs` (30 s by default) and it rejects with a
  `TIMEOUT` `ProviderError`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every webhook is answered `401` | The instance webhook does not send `webhookSecret` in the configured header (`x-webhook-secret`), or `jwt_key` differs from `webhookJwtKey`. Set the webhook again with the same value. |
| The constructor throws `` `baseUrl` must be an absolute http(s) URL `` | Include the scheme: `http://localhost:8080`, not `localhost:8080`. |
| `start()` rejects with *Unauthorized — check the Evolution apiKey* | The `apikey` is wrong: use the global `AUTHENTICATION_API_KEY` or the instance token. |
| `start()` rejects with *Instance or resource not found* | The `instance` name does not exist on that server: create it first (`POST /instance/create`). |
| Sends reject with a `TIMEOUT` `ProviderError` | The instance is not paired: scan the QR from the `connection` update (`authPayload`) or the Evolution manager. |
| The same contact gets a different `senderId` after a restart | Their first message came with the LID only. Pass `identityPersistence` backed by durable storage. |
| `ctx.media` fails for a large file | Raise `http.maxBytes` (64 MiB by default) or enable `webhookBase64` on the instance. |

## Status

Covered by unit and end-to-end tests with a fake Evolution server, and by an opt-in suite
against a real Evolution API `v2.3.4` container (health, instance creation with an
authenticated webhook, QR delivery through the webhook, typed errors for an unpaired
instance and a wrong key). Pairing a real number and the message round trip with
WhatsApp are not covered by the automated suites: try them on a test number before
going to production. Evolution and WhatsApp Web are unofficial; read the
[security guide](https://andresayac.github.io/botmesh/guide/security) and WhatsApp's terms before using a personal number.

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels#botmesh-evolution) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/evolution-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/evolution-provider) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver: a breaking change is a major version. The webhook wire
types (`EvolutionMessage`, `EvolutionWebhook`, ...) are `@experimental`, and
`@botmesh/evolution/internal` (parser, outbound mapper, JWT helpers) has no semver guarantee.
