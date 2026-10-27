# @botmesh/instagram

## 1.0.0-beta.0

### Major Changes

- 2a2f9b2: First public release. `@botmesh/messenger` (Facebook Messenger Send API) and `@botmesh/instagram` (Instagram DMs through the Messenger API for Instagram) were private workspace packages and are now published alongside the other public packages, with their API frozen and covered by semver from 1.0.0.
  
  - Main entries keep what an application needs: the provider, its config, the typed error mapper (`toMessengerError` / `toInstagramError`), the send response type and the webhook payload types. Instagram exports the webhook sub-types it was missing (`IgEntry`, `IgMessage`, `IgAttachment`, `IgAttachmentPayload`, `IgReaction`, `IgPostback`), and `GraphSendResponse` is now `InstagramSendResponse`.
  - The wire helpers moved to a new `/internal` entry with no semver promise: `parseInbound`, `toOutbound` and `toOutboundMessages` in `@botmesh/messenger/internal`; `GraphClient`, `parseInbound` and `toOutbound` in `@botmesh/instagram/internal`.
  - Removed before the first publish: the `toProviderError` aliases and the `verifyChallenge` / `verifySignature` re-exports (use `provider.verifyChallenge(query)` and `provider.ingest()`, or import them from `@botmesh/graph-core`).
  - The `debug` option is deprecated: pass a `logger` (any `LoggerLike`).
  
  What to change when upgrading from a workspace copy: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).

### Patch Changes

- 591b510: README fixes: the `@botmesh/server` examples mount `TelegramProvider` without the `body: 'text'` it no longer needs; `@botmesh/graph-core` names Messenger and Instagram as its other dependents; Twilio explains that the core splits text over 1600 characters; Gupshup's `webhookTokenParam` is also read by `ingest()` with a URL; Evolution says poll votes are not emitted as `'poll'` events yet (it named a `poll-vote` event that does not exist); and the prerelease notes of the packages first published in the beta no longer mention an older alpha.
- 1f7ad7e: Beta review fixes: media captions are sent as a text message after the attachment and a card `imageUrl` as an image after the card text, or alone when the card has no text (both were dropped); a card with no text and no image is rejected; a DM with several photos yields one message per attachment (`<mid>`, `<mid>#2`…) instead of only the first; the user's text is kept next to a shared post or an unknown attachment; `selfId` marks the account's own messages `fromMe`; `ingest()` answers `503` while stopped so Meta redelivers; quick replies are cut on grapheme boundaries and reject an empty text, an empty title, duplicate ids or titles and ids over 1000 characters; a `{ url }` media source must be http(s); `apiVersion`/`graphUrl` are validated at construction and an explicit `undefined` keeps the default; a blank `verifyToken` or `appSecret` fails in the constructor.
- Updated dependencies [591b510]
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/graph-core@1.0.0-beta.2
  - @botmesh/core@2.0.0-beta.4
