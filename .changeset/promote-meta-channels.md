---
"@botmesh/messenger": major
"@botmesh/instagram": major
---

First public release. `@botmesh/messenger` (Facebook Messenger Send API) and `@botmesh/instagram` (Instagram DMs through the Messenger API for Instagram) were private workspace packages and are now published alongside the other public packages, with their API frozen and covered by semver from 1.0.0.

- Main entries keep what an application needs: the provider, its config, the typed error mapper (`toMessengerError` / `toInstagramError`), the send response type and the webhook payload types. Instagram exports the webhook sub-types it was missing (`IgEntry`, `IgMessage`, `IgAttachment`, `IgAttachmentPayload`, `IgReaction`, `IgPostback`), and `GraphSendResponse` is now `InstagramSendResponse`.
- The wire helpers moved to a new `/internal` entry with no semver promise: `parseInbound`, `toOutbound` and `toOutboundMessages` in `@botmesh/messenger/internal`; `GraphClient`, `parseInbound` and `toOutbound` in `@botmesh/instagram/internal`.
- Removed before the first publish: the `toProviderError` aliases and the `verifyChallenge` / `verifySignature` re-exports (use `provider.verifyChallenge(query)` and `provider.ingest()`, or import them from `@botmesh/graph-core`).
- The `debug` option is deprecated: pass a `logger` (any `LoggerLike`).

What to change when upgrading from a workspace copy: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
