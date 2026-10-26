---
"@botmesh/wa-gateway-kit": major
"@botmesh/evolution": major
"@botmesh/wppconnect": major
---

First public release of the WhatsApp REST gateway transports: `@botmesh/evolution` (Evolution API v2) and `@botmesh/wppconnect` (WPPConnect Server), plus the kit they share, `@botmesh/wa-gateway-kit` (REST client over `secureFetch`, outbound media, LID/PN identity reconciliation). Their API is frozen and covered by semver from 1.0.0:

- The providers' main entry holds the provider class, its config, the error mapper (`toEvolutionError`, `toWppError`), `HeaderBag` and the option types (`IdentityPersistence`, `RestHttpOptions`). The webhook wire types (`EvolutionMessage`, `EvolutionWebhook`, `EvolutionMessageKey`, `EvolutionContextInfo`, `WppMessage`, `WppSender`, `WppId`) are `@experimental`.
- The webhook parsers, outbound mappers, media tokens and the HS256 JWT helpers moved to `@botmesh/evolution/internal` and `@botmesh/wppconnect/internal` (no semver). `WaIdentityStore` and `normalizeJid` are no longer re-exported by the providers: import them from `@botmesh/wa-gateway-kit`.
- The `debug` option was removed: pass a `logger`.
- Invalid options throw a `TypeError` from the constructor (also `gatewayBaseUrl()` in the kit).
