# @botmesh/gohighlevel

## 1.0.0-beta.0

### Major Changes

- b1713db: First npm release of the Discord, Twilio, Gupshup, email and HighLevel channels (they were
  private workspace packages). The API was frozen for the release: each main entry keeps what an
  application needs (provider class, config types, typed error mapper, signature helpers) and is
  covered by semver; the wire mappers, gateway/REST clients, MIME helpers and payload types moved
  to a new `/internal` entry with no semver promise. `debug` is deprecated in favour of `logger`
  and Discord's `GatewayIntents` is frozen.

### Patch Changes

- ea39765: Email `InboundMessage` bodies (HTML) now arrive as plain text in `ctx.body`, with the subject,
  thread id and email message id in `ctx.chat.platformData`; `ctx.raw.body` keeps the HTML.
  `accessToken` is validated at construction (string, no `Bearer ` prefix, no spaces, line breaks or
  non-ASCII characters, which made every send fail with an error quoting the token), `baseUrl` must be
  an absolute http(s) URL, and channel names in `defaultChannel` / `platformData.type` match in any
  casing. Entity and channel-name lookups ignore `Object.prototype` names, so an email
  containing `&constructor;` or a webhook `messageType` of `constructor` no longer injects function
  source into `ctx.body` or the chat's channel.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
