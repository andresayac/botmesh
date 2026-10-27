# @botmesh/email

## 1.0.0-beta.0

### Major Changes

- b1713db: First npm release of the Discord, Twilio, Gupshup, email and HighLevel channels (they were
  private workspace packages). The API was frozen for the release: each main entry keeps what an
  application needs (provider class, config types, typed error mapper, signature helpers) and is
  covered by semver; the wire mappers, gateway/REST clients, MIME helpers and payload types moved
  to a new `/internal` entry with no semver promise. `debug` is deprecated in favour of `logger`
  and Discord's `GatewayIntents` is frozen.

### Patch Changes

- 71a69de: Harden inbound header parsing and outbound validation: addresses with whitespace or control
  characters are rejected (they never reach the SMTP envelope), Message-IDs over 998 characters are
  ignored and `References` chains are capped at 100 ids, replies only thread on real Message-IDs, a
  `Date` header in the future no longer becomes `ctx.timestamp`, invalid attachment media types or
  control characters in native attachment fields reject with `UnsupportedContentError`, and TLS
  mismatches, missing mailboxes and SMTP connection failures reject with actionable messages.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
