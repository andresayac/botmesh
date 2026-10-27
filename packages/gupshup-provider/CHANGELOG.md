# @botmesh/gupshup

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
- ac98575: `ingest(body, headers, url)` reads the webhook token from the query string of `url`, so the `?token=` callback URL works behind the `@botmesh/server` ingress (it answered 401); a base64 `webhookToken` pasted raw into `?token=` also matches (a literal `+` is no longer read as a space). Interactive labels are cut to WhatsApp limits on grapheme boundaries (quick-reply titles must stay unique), URL buttons degraded to numbered text keep their link, and 401/403 and network failures carry actionable messages.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
