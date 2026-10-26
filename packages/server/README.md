# @botmesh/server

Webhook ingress for the [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core) channels that receive webhooks: the WhatsApp Cloud API ([`@botmesh/meta`](https://github.com/andresayac/botmesh/tree/main/packages/meta-provider)), [`@botmesh/telegram`](https://github.com/andresayac/botmesh/tree/main/packages/telegram-provider) in webhook mode, and any other provider with an `ingest()` method. It does the part every webhook host has to get right and is easy to get wrong:

- **Raw body bytes**: `provider.ingest()` gets the exact `Buffer` that arrived. Meta's `X-Hub-Signature-256` is computed over those bytes, never over re-serialized JSON.
- **Size limit** (`413`), 1 MiB by default, checked against `Content-Length` and while the stream arrives.
- **Timeouts**: body read (`408`) and `ingest` (`503`).
- **Concurrency cap** (`503` + `Retry-After: 1` when saturated).
- **Routing**: `GET` → `verifyChallenge` (Meta's handshake), `POST` → `ingest(raw, headers)`; the value `ingest` returns is the HTTP status.
- **Health**: `/healthz` (liveness, always 200) and `/readyz` (200 only while the bot is `ready`, your optional `readiness` check passes and the ingress is not shutting down).
- **No sensitive logs**: only method, path, status, sizes and the error class *name*; never bodies, headers, query strings or error messages.
- **No framework dependencies**: structurally typed adapters for `node:http`, Express (4 and 5), Fastify (4 and 5) and Hono, each in its own subpath.

## Install

```bash
pnpm add @botmesh/server
```

Node.js 22 or later, ESM only. It has no dependencies: bring the framework you already use, or none (`node:http` works).

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/server@beta` during the beta (`npm view @botmesh/server dist-tags` lists the tags). Once stable, the plain command above works.

## Quick start (`node:http`)

```ts
import { createServer } from 'node:http'
import { Bot } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'
import { createIngress, createNodeHandler } from '@botmesh/server'

const whatsapp = new CloudAPIProvider({
  accessToken: process.env.META_ACCESS_TOKEN!,
  phoneNumberId: process.env.META_PHONE_NUMBER_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
const bot = new Bot({ provider: whatsapp })
bot.when('hi', (ctx) => ctx.reply('Hello!'))

const ingress = createIngress({
  routes: [
    { path: '/webhook/whatsapp', provider: whatsapp },
    // Telegram in webhook mode: { path: '/webhook/telegram', provider: telegram, body: 'text' },
  ],
  bot, // /readyz answers 200 only while bot.getConnectionState() === 'ready'
})

const server = createServer(createNodeHandler(ingress))
await bot.start()
server.listen(3000)

// Graceful shutdown: stop accepting webhooks, let the in-flight ones finish.
process.on('SIGTERM', async () => {
  await ingress.close({ timeoutMs: 10_000 })
  await bot.stop({ drain: true })
  server.close()
})
```

Point Meta's webhook at `https://<your-host>/webhook/whatsapp`: the `GET` verification and the signed `POST`s both go to that route.

## Frameworks

### Express

```ts
import express from 'express'
import { expressIngress } from '@botmesh/server/express'

const app = express()
app.use(expressIngress(ingress)) // BEFORE express.json()
app.use(express.json())          // the rest of your routes
```

If a parser already consumed the body (`express.json()` mounted first), the ingress answers `500` instead of re-serializing. Behind `express.raw()` it reuses that `Buffer` (and still applies `maxBodyBytes`).

### Fastify

```ts
import Fastify from 'fastify'
import { fastifyIngress } from '@botmesh/server/fastify'

const app = Fastify()
app.register(fastifyIngress(ingress), { prefix: '/hooks' }) // /hooks/webhook/whatsapp, /hooks/healthz...
```

It is an encapsulated plugin: its catch-all parser leaves the stream untouched only for its own routes, and your other routes keep Fastify's JSON parser.

### Hono and fetch runtimes

```ts
import { Hono } from 'hono'
import { createFetchHandler } from '@botmesh/server'
import { honoIngress } from '@botmesh/server/hono'

const app = new Hono()
app.use('*', honoIngress(ingress))          // paths it does not serve go to next()

const handler = createFetchHandler(ingress) // (Request) => Promise<Response>, 404 when no route matches
```

## Options

`createIngress(options)`:

| Option | Default | What it does |
| --- | --- | --- |
| `routes` | required | `{ path, provider, body?: 'buffer' \| 'text', maxBodyBytes? }[]`. `path` is exact and starts with `/`. |
| `maxBodyBytes` | `1048576` (1 MiB) | Largest body accepted (`413`). A route can override it. |
| `bodyTimeoutMs` | `10000` | Time to receive the whole body (`408`). |
| `ingestTimeoutMs` | `10000` | Time for `ingest` to settle (`503`). The concurrency slot is held until it really settles. |
| `maxConcurrent` | `64` | Webhooks being read or ingested at once (`503` beyond it). |
| `healthPath` / `readyPath` | `'/healthz'` / `'/readyz'` | `false` disables the endpoint. |
| `bot` | none | Any object with `getConnectionState()` (a `Bot`); gates `/readyz`. |
| `readiness` | none | Extra check (`() => boolean \| Promise<boolean>`); throwing or `false` means not ready. |
| `logger` | silent | pino-compatible logger (metadata only). |

`createNodeHandler(ingress, { drain, onNotFound })` takes the drain bounds described below and a fallback for the paths the ingress does not serve (default `404`).

## Responses

| Situation | Status |
| --- | --- |
| `ingest` returns a number 100–599 | that number |
| `ingest` returns `{ status, body, headers }` | that status; a string `body` is sent as text, an object as JSON |
| `ingest` returns anything else, or nothing | `200` |
| `ingest` throws a `SyntaxError` / another error | `400` / `500` |
| `GET` and `verifyChallenge` returns a string / `null` | `200` with the challenge / `403` |
| `GET` without `verifyChallenge`, or another method | `405` (with `Allow`) |
| Body too large / too slow | `413` / `408` (with `Connection: close`) |
| Saturated, `ingest` too slow, or shutting down | `503` + `Retry-After: 1` |

With `node:http`, Express and Fastify, before answering with `Connection: close` (413, 503…) the rest of the body is read and discarded, so the client gets the response instead of an `ECONNRESET`. Draining is bounded (8 MiB and 5 s by default, `createNodeHandler(ingress, { drain: { maxBytes, timeoutMs } })`); past that the response is sent and the socket closed. A `408` does not wait for the body.

## Custom adapters

For a framework without an adapter, build an `IngressRequest` and call `ingress.handle(request)`: it resolves the response, or `undefined` when no route matches. `readNodeBody(req, limit, timeoutMs)` and `readWebBody(request, limit, timeoutMs)` read a raw body under those limits and reject with `BodyTooLargeError`, `BodyTimeoutError`, `BodyUnavailableError` or `BodyAbortedError`. `serveNode(ingress, req, res)` and `serveFetch(ingress, request)` serve one Node or WHATWG request.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every Meta webhook gets `403` | The signature check failed: the body was parsed before the ingress (mount it before `express.json()`), or `appSecret` is wrong. |
| Every webhook gets `500` with Express | A body parser ran first and consumed the stream. Mount `expressIngress` before it, or behind `express.raw()`. |
| `413` on large deliveries (email with attachments, batched events) | Raise `maxBodyBytes` for that route only (`{ path, provider, maxBodyBytes }`). |
| `/readyz` stays `503` | The bot is not `ready` (still connecting, or stopped), your `readiness` check failed, or `ingress.close()` was called. |
| `TypeError: provider for "/x" has no ingest()` | That provider opens its own connection (Baileys, Discord, Telegram polling): it needs no ingress. |
| A query-string webhook token is rejected (WPPConnect, Gupshup) | The ingress calls `ingest(raw, headers)` without the URL. Send the token in a header, or mount that route yourself and call the provider's URL-aware method. |

## Links

- [Webhook server guide](https://andresayac.github.io/botmesh/guide/server) · [Channels](https://andresayac.github.io/botmesh/guide/channels) · [Deployment](https://andresayac.github.io/botmesh/guide/deploy) · [Security](https://andresayac.github.io/botmesh/guide/security)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/server/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/server) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver. `@botmesh/server/internal` (path helpers) has no semver promise.
