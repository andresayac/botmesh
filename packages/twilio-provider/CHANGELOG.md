# @botmesh/twilio

## 1.0.0-beta.0

### Major Changes

- b1713db: First npm release of the Discord, Twilio, Gupshup, email and HighLevel channels (they were
  private workspace packages). The API was frozen for the release: each main entry keeps what an
  application needs (provider class, config types, typed error mapper, signature helpers) and is
  covered by semver; the wire mappers, gateway/REST clients, MIME helpers and payload types moved
  to a new `/internal` entry with no semver promise. `debug` is deprecated in favour of `logger`
  and Discord's `GatewayIntents` is frozen.

### Patch Changes

- 591b510: README fixes: the `@botmesh/server` examples mount `TelegramProvider` without the `body: 'text'` it no longer needs; `@botmesh/graph-core` names Messenger and Instagram as its other dependents; Twilio explains that the core splits text over 1600 characters; Gupshup's `webhookTokenParam` is also read by `ingest()` with a URL; Evolution says poll votes are not emitted as `'poll'` events yet (it named a `poll-vote` event that does not exist); and the prerelease notes of the packages first published in the beta no longer mention an older alpha.
- bb1fd93: The request URL handed to `ingest()` (third argument) now carries the query string exactly as received instead of `URLSearchParams.toString()`, which re-encoded it. `IngressRequest` takes an optional `rawQuery` (filled by `createNodeHandler`, the Express/Fastify/Hono adapters and `createFetchHandler`; custom adapters that omit it keep the old behaviour) and `splitUrl()` returns it. Before, `TwilioProvider` with `webhookPath` behind `@botmesh/server` answered 403 to every correctly signed request whose console URL had a query such as `?tenant=a%20b`, `?flag`, `?next=/x` or `?t=~x`.
- c361ba3: Webhook params named like `Object.prototype` members (`constructor`, `toString`, `__proto__`…) are kept as plain own params: before, they read inherited members or swapped the params object's prototype, and the signature check rejected a correctly signed request. With `webhookPath`, `ingest(body, headers, requestUrl)` now takes the request's query string (which Twilio signs) when `webhookPath` has none; `@botmesh/server` passes it. The constructor rejects whitespace in `accountSid`, `authToken`, `apiKeySid`, `apiKeySecret` and `webhookUrl` and a `whatsapp:` `smsFrom`, and a REST 401 names the credentials to check.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
