# @botmesh/messenger

## 1.0.0-beta.0

### Major Changes

- 2a2f9b2: First public release. `@botmesh/messenger` (Facebook Messenger Send API) and `@botmesh/instagram` (Instagram DMs through the Messenger API for Instagram) were private workspace packages and are now published alongside the other public packages, with their API frozen and covered by semver from 1.0.0.
  
  - Main entries keep what an application needs: the provider, its config, the typed error mapper (`toMessengerError` / `toInstagramError`), the send response type and the webhook payload types. Instagram exports the webhook sub-types it was missing (`IgEntry`, `IgMessage`, `IgAttachment`, `IgAttachmentPayload`, `IgReaction`, `IgPostback`), and `GraphSendResponse` is now `InstagramSendResponse`.
  - The wire helpers moved to a new `/internal` entry with no semver promise: `parseInbound`, `toOutbound` and `toOutboundMessages` in `@botmesh/messenger/internal`; `GraphClient`, `parseInbound` and `toOutbound` in `@botmesh/instagram/internal`.
  - Removed before the first publish: the `toProviderError` aliases and the `verifyChallenge` / `verifySignature` re-exports (use `provider.verifyChallenge(query)` and `provider.ingest()`, or import them from `@botmesh/graph-core`).
  - The `debug` option is deprecated: pass a `logger` (any `LoggerLike`).
  
  What to change when upgrading from a workspace copy: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).

### Patch Changes

- 48d1479: Fixes from the beta release test:
  
  - No outbound text is cut or rejected: a list sends its text before the generic template (the template has no header, so the text was dropped), button text past the template's 640 characters goes first as plain text, `buttons` with no buttons is plain text, and card or list text over 2000 characters is split into several messages instead of failing at Graph.
  - Button and template labels are cut on grapheme boundaries (an emoji ZWJ sequence was split into a different symbol).
  - Inbound: a `message_edits` webhook arrives as a message with the original id (new `isEditedMessage()` export); every attachment of a multi-attachment message reaches the bot (ids `<mid>`, `<mid>#2`…; only the first one did); a location keeps the place name Meta sends next to its payload; a shared link (`fallback` attachment) is a text message with its title and URL instead of a "document" whose download fetched the web page; a postback without `mid` gets a stable id from its timestamp, so a Meta retry is deduplicated.
  - Message tags: `options.platformData` sets `tag`, `messaging_type`, `notification_type` and `persona_id` (a tag implies `MESSAGE_TAG`; a wrong type throws a `TypeError`; other keys are ignored). The README pointed to `ctx.sendNative()` for tags, which could not set them.
  - The page id and API version are URL-encoded in the Send API path.
- 591b510: `CloudAPIProvider.ingest()` and `MessengerProvider.ingest()` answer `503` while the provider is stopped (after `bot.stop()`, until the next `bot.start()`), like `@botmesh/instagram` and `@botmesh/telegram`. Before, a webhook that arrived while the bot was stopped was acknowledged with `200` and the message was lost; now Meta delivers it again after the restart.
- Updated dependencies [591b510]
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/graph-core@1.0.0-beta.2
  - @botmesh/core@2.0.0-beta.4
