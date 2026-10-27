# @botmesh/moderation

## 1.0.0-beta.0

### Major Changes

- dfcdd06: First public release. These plugins were private workspace packages; they now ship to npm with the beta and their API is frozen and covered by semver from 1.0.0. Each package keeps on its main entry what an application needs and moves its building blocks to a new `/internal` entry, without a semver guarantee (`@botmesh/nlu` has no internal entry):
  
  - `@botmesh/rag/internal`: `splitMarkdownSections`, `MarkdownSection`, `resolveChunkOptions`, `cosine`, `hashText`, `tokenize`, `resolveEmbedder`, `createPdfParser`. `SUPPORTED_EXTENSIONS` is frozen.
  - `@botmesh/voice/internal`: `trimPunctuation`, `resolveStt`, `resolveTts`, `OPENAI_TTS_MIMETYPES`, `elevenLabsMimetype`, `estimateOggDurationSec`, `estimateDurationSec`, `sniffMimetype`. `DEFAULT_VOICE_LIMITS` and `OPENAI_TTS_MIMETYPES` are frozen.
  - `@botmesh/dialogflow/internal`: `normalizeEsResult`, `normalizeCxResult`, `toSessionId`, `parseCredentials`, `createServiceAccountJwt`, `DIALOGFLOW_SCOPE`, `DEFAULT_TOKEN_URI`. `dialogflowPlugin` is the canonical name; `dialogflowContext` stays as a `@deprecated` alias of the same function.
  - `@botmesh/chatwoot/internal`: `ChatwootMapping`, `verifyWebhook`, `WebhookAuthConfig`, `inboundText`, `outboundText` (`chatwootPlugin().handleWebhook` and `webhookHandler` keep verifying every delivery). `handleWebhook({ query })` accepts `URLSearchParams` or any parsed query object such as Express `req.query`; only a string `token` is read.
  - `@botmesh/tickets/internal`: `renderTemplate`, `localClock`. `TICKET_PRIORITIES` and `TICKET_STATUSES` are frozen.
  - `@botmesh/moderation/internal`: `findLinks`, `findInviteLinks`, `InviteLink`, `compileTerms`, `foldText`, `CompiledTerm`. `GroupAdminApi` and `ModerationProvider.groups` stay on the main entry but are `@experimental` (outside semver) until `@botmesh/core` defines a groups capability for providers.

### Patch Changes

- a169d63: Harden the moderation plugin:
  
  - The config is validated by `moderationPlugin()`, `new Moderator()` and `setGroupRules()`: an unknown action, a non-positive count, window or `muteMs`, or a field of the wrong type throws a `TypeError`/`RangeError` that names the field (a typo such as `action: 'ban'` used to fail on the first violation and drop the message). `mute()` rejects a non-positive duration.
  - An `isAdmin` callback that throws is logged and the sender is treated as a non-admin, instead of every group message failing to dispatch.
  - Admins are looked up only for messages that break a rule or come from a muted user. A failing `groups.getAdmins` keeps the last known list and is retried after `min(adminCacheMs, 30s)` rather than on every message.
  - Words and links are matched after dropping invisible characters and folding compatibility forms, so a zero-width-split word, fullwidth `ｓｐａｍ` or a zero-width-split invite no longer slips through. An invite host must start its hostname (`chat.me/+abcd` is not a Telegram invite), while WhatsApp formatting marks around a link (`_chat.whatsapp.com/…_`, `*…*`, `~…~`) do not hide it from the invite or `allLinks` filters.
  - `{name}` in warnings is a sanitized one-line display name of at most 64 characters.
  - Anti-spam windows of different lengths no longer reset each other under load, and the idle-key sweep is amortized.
  - Unplugging removes `ctx.tools.moderation`.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
