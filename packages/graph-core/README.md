# @botmesh/graph-core

Shared **Meta Graph API** helpers for the Meta transports of [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core): [`@botmesh/meta`](https://www.npmjs.com/package/@botmesh/meta) (WhatsApp Cloud API), Messenger and Instagram. The three platforms verify webhooks the same way, sign them the same way and return the same Graph error codes; this package holds that logic once.

**You do not need it to build a bot**: it is installed as a dependency of `@botmesh/meta`. Use it directly when you write your own Graph integration or webhook endpoint and want the same signature checks and error mapping.

## Install

```bash
pnpm add @botmesh/graph-core
```

Node.js 22 or later, ESM only. It depends only on `@botmesh/core` and Node's built-in `crypto`.

> **Prerelease.** Until the stable release, botmesh packages are published under a prerelease dist-tag instead of `latest`: add it to the command (`pnpm add @botmesh/graph-core@alpha`, or `@beta` during the beta).

## Quick start: a verified webhook endpoint

```ts
import { createServer } from 'node:http'
import { checkGraphSignature, tryParseGraphBody, verifyChallenge } from '@botmesh/graph-core'

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // GET: subscription handshake
  if (req.method === 'GET') {
    const challenge = verifyChallenge(Object.fromEntries(url.searchParams), process.env.META_VERIFY_TOKEN!)
    res.writeHead(challenge === null ? 403 : 200).end(challenge ?? '')
    return
  }

  // POST: verify X-Hub-Signature-256 over the RAW bytes, then parse
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const rawBody = Buffer.concat(chunks)

  const sig = checkGraphSignature({ body: rawBody, headers: req.headers, appSecret: process.env.META_APP_SECRET })
  if (!sig.ok) return void res.writeHead(sig.status).end() // 400: body not raw, 403: bad signature
  const parsed = tryParseGraphBody<{ object: string }>(rawBody)
  if (!parsed.ok) return void res.writeHead(parsed.status).end() // 400: not a JSON object

  console.log('webhook for', parsed.body.object)
  res.writeHead(200).end()
}).listen(3000)
```

> **Sign over the raw bytes.** Meta signs exactly the bytes it sends. A body parsed and re-serialized (for example by `express.json()` without keeping the original buffer) no longer matches, and every request fails with `403`. Pass the raw body: `express.raw({ type: 'application/json' })`, or the `Buffer` you collect with `node:http`.

Without an `appSecret`, `checkGraphSignature` lets every request through. That is why the Meta providers require `appSecret` and accept running without it only with an explicit opt-in for local development (`allowUnsignedWebhooks: true`).

## API

| Export | What it is for |
| --- | --- |
| `verifyChallenge(query, verifyToken)` | Webhook `GET` handshake. Returns the `hub.challenge` to answer with (HTTP 200), or `null` when the token does not match (answer 403). |
| `checkGraphSignature({ body, headers, appSecret, logger? })` | Ingest guard: `{ ok: true }` or `{ ok: false, status }`. With an `appSecret` it requires the **raw** body (`string`, `Buffer` or `Uint8Array`) and answers `400` for an already-parsed one and `403` for a bad signature. The positional form `(body, headers, appSecret, logger?)` is deprecated. |
| `verifySignature(rawBody, header, appSecret)` | Low-level check of `X-Hub-Signature-256` (HMAC-SHA256 of the body, constant time). `false` when the secret or header is missing or they do not match. |
| `tryParseGraphBody<T>(body)` | Parses the body without throwing: `{ ok: true, body }`, or `{ ok: false, status: 400 }` when it is not a JSON object. |
| `parseGraphBody<T>(body)` | Same, but throws `SyntaxError` on a raw body that is not JSON. |
| `toGraphError(err, { chatId?, retryAfterMs?, contentKind? })` | Maps a Graph error to the core's typed `ProviderError` subclasses (table below). |
| `readGraphResponse<T>(res, opts?)` | Reads a Graph `fetch` response: resolves to the JSON body, or rejects with the `toGraphError` mapping when the status fails or the body has an `error`. A `Retry-After` header sets `retryAfterMs` (capped at 24 h). |
| `graphRequest<T>(url, init, { timeoutMs?, fetch?, chatId?, contentKind? })` | `fetch` plus `readGraphResponse` under one deadline (`DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`, 60 s). Failures reject with a `ProviderError` whose message never includes the URL or the token. |
| `DEFAULT_GRAPH_API_VERSION` | The Graph API version the Meta providers call by default (`'v26.0'`). It follows Meta's current version and may move in a minor release: set `apiVersion` on the provider to stay on one. |
| `META_MEDIA_HOSTS`, `serializeUrlMediaRef`, `rehydrateUrlMediaRef` | Durable media references for the URL-token transports (Messenger, Instagram): only an allow-listed URL is stored, and a stored value is validated again when read back. |

## Error mapping

`toGraphError` (and so `readGraphResponse` and `graphRequest`) covers the WhatsApp business codes and the generic Facebook/Instagram limits:

| Graph code | Core error |
|---|---|
| `131047`: outside the 24-hour window (WhatsApp) | `OutsideSessionWindowError`: send a template (`kind: 'template'`) |
| `131026`: recipient cannot receive | `RecipientUnreachableError` |
| `131030`: recipient not in the test number's allowed list (WhatsApp) | `RecipientUnreachableError` |
| `551`: the person is unavailable (Messenger/Instagram) | `RecipientUnreachableError` |
| `10` with subcode `2018278` (Messenger) or `2534022` (Instagram): outside the messaging window | `OutsideSessionWindowError` |
| subcodes `1545041`, `2018001`, `2534014`: no matching user (Messenger/Instagram) | `RecipientUnreachableError` |
| `131051`: unsupported message type | `UnsupportedContentError` (`kind`: the send's `contentKind`, or `'native'`) |
| `131062`: the username (BSUID) recipient does not accept this message (*one-tap*, *zero-tap* and *copy code* authentication templates) | `UnsupportedContentError` (`kind`: the send's `contentKind`, or `'template'`): send it to the phone number instead |
| `4`, `613`, `80007`, `36003`: rate limit | `RateLimitedError` (`retryAfterMs`, or 60 s) |
| `130429`: Cloud API messages-per-second limit | `RateLimitedError` (`retryAfterMs`, or 1 s) |
| `131056`: too many messages to the same user (pair rate limit) | `RateLimitedError` (`retryAfterMs`, or 6 s) |
| `131048`: spam limit | `RateLimitedError` (`retryAfterMs`, or 60 s) |
| `190`: invalid or expired access token | `ProviderError`, with a hint to check the token |
| `100` with subcode `33`: the phone number, page or WABA id does not exist, or the token cannot reach it | `ProviderError`, with a hint to check the configured id |
| anything else (including `147001`–`147005` from the username API) | `ProviderError` |

Codes that arrive as digit strings are mapped like numbers. Pass `contentKind` (the `kind` of the content that failed) when you know it, so `UnsupportedContentError.kind` names what Graph rejected.

```ts
import { toGraphError } from '@botmesh/graph-core'
import { OutsideSessionWindowError } from '@botmesh/core'

const err = toGraphError({ code: 131047, message: 'Re-engagement message' }, { chatId: '573001234567' })
console.log(err instanceof OutsideSessionWindowError) // true
```

## Links

- [WhatsApp Cloud API provider](https://www.npmjs.com/package/@botmesh/meta) · [Security guide](https://andresayac.github.io/botmesh/guide/security) (webhook authentication) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/graph-core/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/graph-core) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver: a breaking change is a major version.
