# @botmesh/wa-gateway-kit

Building blocks shared by the WhatsApp REST gateway transports of
[`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core):
[`@botmesh/evolution`](https://www.npmjs.com/package/@botmesh/evolution) (Evolution API) and
[`@botmesh/wppconnect`](https://www.npmjs.com/package/@botmesh/wppconnect) (WPPConnect Server).
Both talk to a self-hosted gateway built on WhatsApp Web, so they share the same REST client,
the same outbound media handling and the same LID/PN identity reconciliation; this package
holds that code once.

**You do not need it to build a bot**: it is installed as a dependency of those providers,
which re-export the types their options use (`IdentityPersistence`, `RestHttpOptions`). Use
it directly when you write a transport for another WhatsApp Web gateway and want the same
guarantees.

## Install

```bash
pnpm add @botmesh/wa-gateway-kit
```

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

Node.js 22 or later, ESM only. It depends only on `@botmesh/core` and
[`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http).

## Quick example

```ts
import { ProviderError } from '@botmesh/core'
import { WaIdentityStore, gatewayBaseUrl, resolveHttpPolicy, restCall } from '@botmesh/wa-gateway-kit'

const baseUrl = gatewayBaseUrl('MyGatewayProvider', 'http://localhost:8080') // TypeError without http(s)://
const http = resolveHttpPolicy(baseUrl, { timeoutMs: 15_000 })

// JSON over secureFetch: no redirects, size and time limits, no URL path in errors when `label` is set.
const res = await restCall(`${baseUrl}/message/sendText/demo`, {
  method: 'POST',
  headers: { apikey: process.env.GATEWAY_KEY! },
  body: { number: '573001112233', text: 'hi' },
  label: 'sendText',
}, http)
if (!res.ok) throw new ProviderError(`gateway answered ${res.status}`)

// One stable id per person, whether the gateway sends the phone-number JID or the LID.
const ids = new WaIdentityStore(10_000)
ids.resolve('123456789@lid', '573001112233@s.whatsapp.net') // → '573001112233@s.whatsapp.net'
ids.lookup('123456789@lid')                                  // → '573001112233@s.whatsapp.net'
```

## API

| Export | What it does |
| --- | --- |
| `restCall(url, init, http)` | JSON request through `secureFetch` with `maxRedirects: 0`. Resolves to `{ status, ok, body, retryAfterMs }` for any non-redirect HTTP answer. A network failure, a 3xx answer, an invalid URL or a body `JSON.stringify` cannot serialize rejects with a `ProviderError` that names the cause (`ECONNREFUSED`, `TIMEOUT`...) and shows `init.label` (or the URL path, never the query string) instead of the full URL. |
| `resolveHttpPolicy(baseUrl, http?)` | Fills the `RestHttpOptions` defaults: `allowHttp` when `baseUrl` is `http://`, `allowPrivateHosts: true` (the gateway is usually local), `timeoutMs` 30 s, `maxBytes` 64 MiB. Throws a `TypeError` when `timeoutMs` is not a positive number or `maxBytes` is not a non-negative integer. |
| `gatewayBaseUrl(owner, baseUrl)` | Validates and trims the base URL; throws a `TypeError` naming `owner` when it is not an absolute http(s) URL, or when it has credentials (`user:pass@`), a query string or a fragment. The message masks credentials. |
| `parseRetryAfter(value)` | `Retry-After` (delay-seconds or HTTP date) in milliseconds; `undefined` for anything else (hex, exponents, negative numbers). |
| `describeErrorBody(body)` | One readable line from a gateway error body (at most 300 characters). |
| `isRecord(value)` | Plain-object type guard. |
| `resolveMedia(kind, source, opts?)` | Outbound media: only an `http(s)` URL (as a string or `{ url }`) is handed to the gateway to download, and `{ native: string }` passes through untouched. `{ url }` is always a link: besides `http(s)` it only takes a base64 `data:` URI, and a local path or `file:` URL there rejects (it is never read, so a URL that comes from a user or a model cannot pull a file off the bot's host). A base64 `data:` URI, a Buffer, a stream, `{ path }` or a plain path string (or `file:` URL string) is read here and sent inline as base64 with a MIME type, so the gateway is never asked to open a path on its own host. A malformed source, a non-http(s) `{ url }`, an unreadable path or a stream that does not yield bytes rejects with `UnsupportedContentError`. Returns a `ResolvedMedia`. |
| `toDataUri(media)`, `guessMimetype(kind, filename?, explicit?)` | Data URI (or the plain URL) and best-effort MIME type. |
| `WaIdentityStore(maxEntries?, persistence?)` | Bounded LRU that links the phone-number JID and the LID of the same person to one canonical id (`resolve`, `lookup`, `has`, `size`). `maxEntries` is a positive integer (default 10 000) or `Infinity`; anything else throws a `TypeError`. With an `IdentityPersistence`, the map survives restarts. |
| `normalizeJid(jid)`, `isLidJid(jid)`, `isGroupJid(jid)` | JID helpers: strip whitespace and the device suffix (idempotent), detect `@lid` and `@g.us`. |

Types: `RestHttpOptions`, `RestResponse`, `ResolvedMedia`, `IdentityPersistence`.

## Identity rules

`WaIdentityStore.resolve(primary, ...twins)` picks the canonical id once and keeps it: the
phone-number JID when it is known the first time the person is seen, otherwise the first
alias seen. A later message that reveals the phone number keeps the id the conversation
already uses. Since "first seen" depends on message order, back the store with an
`IdentityPersistence` (synchronous `get`/`set` that must not throw) on durable storage, or the
id of a contact first seen with the LID only can change after a restart.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `TypeError` "`baseUrl` must be an absolute http(s) URL" | Include the scheme: `http://localhost:8080`, not `localhost:8080`. |
| `TypeError` "`baseUrl` must not contain credentials / have a query string" | Request paths are appended to `baseUrl`, so it can only be scheme, host, port and an optional path prefix. Pass the gateway key in its own option. |
| `UnsupportedContentError` "`{ url }` must be an http(s) URL or a base64 data: URI" | `{ url }` is a link, never a local read. Send a local file as `{ path: '/abs/file.png' }` or a plain path string. |
| `ProviderError` "the gateway answered a redirect (HTTP 3xx)" | Gateway calls never follow redirects. The gateway (or a proxy in front of it) redirects `baseUrl`: usually `http://` where it wants `https://`, or a missing path prefix. Use the final URL. |
| A gateway on `https://` inside your network is refused | `allowPrivateHosts` defaults to `true`; if you set it to `false`, private and loopback addresses are blocked by the SSRF guard. |
| A large media download fails | Raise `maxBytes` (64 MiB by default): gateways return media inline as base64. |
| `restCall` resolved but the call failed | `restCall` does not throw on HTTP errors: check `res.ok` and map `res.status` to a typed error (see `toEvolutionError` / `toWppError`). |

## Links

- [Channels guide](https://botmesh.afaya.com.co/guide/channels) · [Security](https://botmesh.afaya.com.co/guide/security) · [Troubleshooting](https://botmesh.afaya.com.co/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/wa-gateway-kit/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/wa-gateway-kit) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver: a breaking change is a major version.
