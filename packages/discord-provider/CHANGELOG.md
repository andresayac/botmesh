# @botmesh/discord

## 1.0.0-beta.0

### Major Changes

- b1713db: First npm release of the Discord, Twilio, Gupshup, email and HighLevel channels (they were
  private workspace packages). The API was frozen for the release: each main entry keeps what an
  application needs (provider class, config types, typed error mapper, signature helpers) and is
  covered by semver; the wire mappers, gateway/REST clients, MIME helpers and payload types moved
  to a new `/internal` entry with no semver promise. `debug` is deprecated in favour of `logger`
  and Discord's `GatewayIntents` is frozen.

### Patch Changes

- a340249: Release review fixes. Ids and interaction tokens are percent-encoded as single REST path
  segments (an empty, `.` or `..` id rejects with `ProviderError`), so a crafted chat or message
  id can no longer reach another route with the bot token. Every sent message carries
  `allowed_mentions` (new `allowedMentions` option, default `{ parse: ['users'] }`), so echoed
  text cannot ping `@everyone`, `@here` or roles; a quoted reply still pings the replied author
  (`replied_user: true` unless `allowedMentions.replied_user` is `false`). A caption over 1024 characters no longer
  breaks the upload (the alt text is cut). A message without text or file arrives as `sticker`
  or `unknown`, never as an empty text; guild interactions carry `chat.platformData.guildId`.
  A second `start()`, also one overlapping another `start()` or a `stop()`, closes the
  previous gateway and never leaves an orphan socket, and frames from a superseded socket are
  ignored. An explicit `undefined` keeps the config defaults; a `Bot `-prefixed token, a
  negative `reconnectDelayMs` or non-integer `intents` throw clear errors. 40003 `retry_after`
  is validated. `GatewayIntents` gains the scheduled-events, auto-moderation and poll bits.
  The alpha aliases `toProviderError`, `autoAckMs` and the `"<id>:<token>"` interaction form
  were removed before the first publish.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
