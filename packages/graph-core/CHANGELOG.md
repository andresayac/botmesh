# @botmesh/graph-core

## 1.0.0-beta.1

### Major Changes

- 79af076: First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).

### Minor Changes

- d43e55c: **Breaking (default): Graph API v26.0.** The Meta providers now call Graph API `v26.0` by default (it was `v21.0`, which Meta retires on 2027-01-21). The default lives in the new `DEFAULT_GRAPH_API_VERSION` export of `@botmesh/graph-core` and follows Meta's current version; the send and webhook payloads the providers use did not change between v21.0 and v26.0. Pass `apiVersion` to stay on a version (`apiVersion: 'v21.0'` restores the previous behaviour).
  
  - `@botmesh/meta`: WhatsApp's `played` status (a voice note was listened to) is now reported as a `read` status with `platformData.played: true`; it used to be dropped. Statuses without the `conversation` object (Graph v24.0+) keep working.
- 51486ac: New `graphRequest(url, init, { timeoutMs?, fetch?, chatId?, contentKind? })` and `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS` (60 s): one Graph API call with a client timeout that covers the body too, errors mapped by `readGraphResponse`, and transport failures or timeouts rejected with a `ProviderError` that never quotes the URL or the token. The Messenger and Instagram providers use it for their `requestTimeoutMs` option.
- c60603f: `checkGraphSignature` takes one options object: `checkGraphSignature({ body, headers, appSecret, logger })`. The positional form `(body, headers, appSecret, logger?)` is a deprecated overload with the same results. New types `GraphSignatureOptions` and `GraphWebhookHeaders`. graph-core is public and covered by semver like the other public packages.

### Patch Changes

- 54ebba3: README rework for the stable line: one structure (what it is, install, quick start, options, errors, links), a single note about the prerelease dist-tag instead of hard-coded `@alpha` commands, no stale "alpha/experimental" banners, English examples and canonical option names only. Fixes wrong samples: `secureFetch` resolves `{ url, response, body }` with the body already read (the old sample called `response.json()`), the Meta webhook sample keeps the raw body with `express.raw()` (no `any` casts), the Meta pricing sample was not valid TypeScript, and the Redis Cluster sample passes `rootNodes` as URL strings. Documents the previously missing exports (`assertSafeTarget`, `isAllowedHostUrl`, `isPrivateAddress`, `graphRequest`, `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`) and the errors users hit (pnpm build scripts, `better-sqlite3` on Node.js 24.19, Graph `190`/`100`/`131030`, Telegram `404`).
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
- d038a99: `readGraphResponse()` parses the `Retry-After` HTTP-date strictly (IMF-fixdate, RFC 850 and asctime, all as GMT): garbage such as `abc 5`, which the engine's lenient date parser read as a date in 2001 and so as "retry now", falls back to the code's default again. A huge value (seconds or date) is capped at 24 hours, so it can never overflow `setTimeout` and turn a rate limit into an immediate retry storm.
- db6c410: `readGraphResponse()` reads `Retry-After` safely: a negative value no longer produces a negative `retryAfterMs`, `0` means retry now, and the HTTP-date form is understood (garbage falls back to the code's default). `toGraphError()` maps error codes that arrive as digit strings, ignores a non-string `message`, and adds a hint to code `190` (invalid or expired access token) and `100`/`33` (the configured phone number, page or WABA id does not exist or is not reachable).
- bf5f3f1: `readGraphResponse` maps an HTTP 413 answer (a request or media upload over Graph's size limit, usually with no specific error code) to `PayloadTooLargeError` instead of a generic `ProviderError`. A specific Graph code in the body (rate limit, window, unreachable) still wins. This applies to the WhatsApp Cloud API, Messenger and Instagram providers.
- Updated dependencies [ac11ddf]
- Updated dependencies [ac11ddf]
- Updated dependencies [ac11ddf]
- Updated dependencies [50fb2b6]
- Updated dependencies [473728a]
- Updated dependencies [088c920]
- Updated dependencies [b4c298d]
- Updated dependencies [c03fb3c]
- Updated dependencies [a448242]
- Updated dependencies [a7992c3]
- Updated dependencies [0864a3b]
- Updated dependencies [a998e70]
- Updated dependencies [50fb2b6]
- Updated dependencies [50fb2b6]
- Updated dependencies [473728a]
- Updated dependencies [511589e]
- Updated dependencies [9bb285a]
- Updated dependencies [88c0fef]
- Updated dependencies [59a09d1]
- Updated dependencies [473728a]
- Updated dependencies [0c0d203]
- Updated dependencies [50fb2b6]
- Updated dependencies [ee49c56]
- Updated dependencies [2ff24f5]
- Updated dependencies [50fb2b6]
- Updated dependencies [b9a9d6a]
- Updated dependencies [a2c946a]
- Updated dependencies [5ad624e]
  - @botmesh/core@2.0.0-beta.3

## 0.2.0-alpha.0

### Minor Changes

- b0034aa: - New `tryParseGraphBody(body)`: non-throwing body parse that returns `{ ok: false, status: 400 }` for anything that is not a JSON object, so `ingest()` handlers can answer 400 to malformed input.
  - `checkGraphSignature` and `parseGraphBody` accept a `Uint8Array` / `ArrayBuffer` raw body (fetch-style request handlers), not only `string` / `Buffer`.
  - `toGraphError` maps more codes: `130429` (throughput), `131056` (pair rate limit) and `131048` (spam rate limit) to `RateLimitedError` with per-code default delays; `131030` (test number allowed list) and `551` (person unavailable) to `RecipientUnreachableError`; Messenger/Instagram `10` / subcode `2018278` (outside the messaging window) to `OutsideSessionWindowError`.
- 1cc2146: New `readGraphResponse(res, { chatId, contentKind, retryAfterMs })`: the single Graph response check shared by the Cloud API, Messenger and Instagram clients. It resolves to the JSON body, or rejects with the typed error `toGraphError` maps it to (honouring `Retry-After`), so the Messenger Platform window / unreachable codes live in one place.
- f8c1d4f: Helpers for durable media references whose token is a hosted URL. `@bot-wa/http` adds `isAllowedHostUrl(url, { hosts, allowHttp?, maxLength? })`, a synchronous host allow-list check (a name also allows its subdomains, an IP literal only itself) for URLs read back from storage. `@bot-wa/graph-core` adds `META_MEDIA_HOSTS` (the Messenger/Instagram attachment CDNs), `serializeUrlMediaRef` and `rehydrateUrlMediaRef`, which the Messenger and Instagram providers use for `serializeMediaRef`/`rehydrateMediaRef`.

### Patch Changes

- 522bcca: Map Graph error `131062` (BSUID recipient not supported, e.g. authentication templates) to `UnsupportedContentError`.
- 9ec06c8: Security: `verifyChallenge` compares `hub.verify_token` in constant time and rejects an empty configured token and non-string query values; `checkGraphSignature` finds `X-Hub-Signature-256` case-insensitively and `verifySignature` validates the hex digest format.
- 8854c8e: `toGraphError` maps the Messenger Platform send errors: window subcodes 2018278 / 2534022 to `OutsideSessionWindowError`, and code 551 plus subcodes 1545041 / 2018001 / 2534014 to `RecipientUnreachableError` (with the `chatId`).
- ce7790f: Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
- Updated dependencies [2e16743]
- Updated dependencies [397c2be]
- Updated dependencies [0a2291f]
- Updated dependencies [ddfb1e9]
- Updated dependencies [ee5777c]
- Updated dependencies [522bcca]
- Updated dependencies [588fa34]
- Updated dependencies [a33cb08]
- Updated dependencies [909fa96]
- Updated dependencies [9cb6621]
- Updated dependencies [99251ef]
- Updated dependencies [7cc66b2]
- Updated dependencies [39a8149]
- Updated dependencies [31fcc2e]
- Updated dependencies [40fdab4]
- Updated dependencies [4bbd0ad]
- Updated dependencies [f8c1d4f]
- Updated dependencies [231cbd2]
- Updated dependencies [ca25eb7]
- Updated dependencies [18958c6]
- Updated dependencies [40ec0bd]
- Updated dependencies [fd07c8c]
- Updated dependencies [0149d66]
- Updated dependencies [9c94d93]
- Updated dependencies [08a933f]
- Updated dependencies [1a81406]
- Updated dependencies [64fb59f]
- Updated dependencies [2549ffe]
- Updated dependencies [a4e9429]
- Updated dependencies [310db8d]
- Updated dependencies [2bab262]
- Updated dependencies [6ea4442]
- Updated dependencies [136caa5]
- Updated dependencies [634993f]
- Updated dependencies [b866fbd]
- Updated dependencies [c6a4292]
- Updated dependencies [7b00477]
- Updated dependencies [6504335]
- Updated dependencies [ce42173]
- Updated dependencies [1984f6f]
- Updated dependencies [522bcca]
- Updated dependencies [02a21cc]
- Updated dependencies [23371fb]
- Updated dependencies [9b97391]
- Updated dependencies [f25b2af]
- Updated dependencies [2232f88]
- Updated dependencies [27620ef]
- Updated dependencies [e4574e6]
- Updated dependencies [ce7790f]
- Updated dependencies [b95b523]
- Updated dependencies [5196990]
- Updated dependencies [2c4f9f0]
- Updated dependencies [efb1fa6]
- Updated dependencies [4fc0560]
  - @bot-wa/core@2.0.0-alpha.2
