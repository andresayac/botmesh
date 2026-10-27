# @botmesh/wa-gateway-kit

## 1.0.0-beta.0

### Major Changes

- b4bee97: First public release of the WhatsApp REST gateway transports: `@botmesh/evolution` (Evolution API v2) and `@botmesh/wppconnect` (WPPConnect Server), plus the kit they share, `@botmesh/wa-gateway-kit` (REST client over `secureFetch`, outbound media, LID/PN identity reconciliation). Their API is frozen and covered by semver from 1.0.0:
  
  - The providers' main entry holds the provider class, its config, the error mapper (`toEvolutionError`, `toWppError`), `HeaderBag` and the option types (`IdentityPersistence`, `RestHttpOptions`). The webhook wire types (`EvolutionMessage`, `EvolutionWebhook`, `EvolutionMessageKey`, `EvolutionContextInfo`, `WppMessage`, `WppSender`, `WppId`) are `@experimental`.
  - The webhook parsers, outbound mappers, media tokens and the HS256 JWT helpers moved to `@botmesh/evolution/internal` and `@botmesh/wppconnect/internal` (no semver). `WaIdentityStore` and `normalizeJid` are no longer re-exported by the providers: import them from `@botmesh/wa-gateway-kit`.
  - The `debug` option was removed: pass a `logger`.
  - Invalid options throw a `TypeError` from the constructor (also `gatewayBaseUrl()` in the kit).

### Patch Changes

- 591b510: README fixes: the `@botmesh/server` examples mount `TelegramProvider` without the `body: 'text'` it no longer needs; `@botmesh/graph-core` names Messenger and Instagram as its other dependents; Twilio explains that the core splits text over 1600 characters; Gupshup's `webhookTokenParam` is also read by `ingest()` with a URL; Evolution says poll votes are not emitted as `'poll'` events yet (it named a `poll-vote` event that does not exist); and the prerelease notes of the packages first published in the beta no longer mention an older alpha.
- e385a57: Hardening of the WhatsApp REST gateway kit: `gatewayBaseUrl()` rejects credentials, query strings and fragments (and masks credentials in the message); `resolveHttpPolicy()` and `WaIdentityStore` (`identityCacheSize`) validate their numbers with a `TypeError`; `resolveMedia()` only hands `http(s)` URLs to the gateway (a `{ url }` must be `http(s)` or a base64 `data:` URI, which is sent inline; a local path or `file:` URL in `{ url }` rejects with `UnsupportedContentError` and is never read, so send local files as `{ path }` or a plain path string) and rejects malformed sources with `UnsupportedContentError`; `restCall()` explains a 3xx answer and reports invalid URLs and unserializable bodies as `ProviderError`; `parseRetryAfter()` follows RFC 9110; `describeErrorBody()` always caps at 300 characters; `normalizeJid()` is idempotent and runs in linear time.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
