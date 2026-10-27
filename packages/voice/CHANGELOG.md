# @botmesh/voice

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

- 00c3eea: `maxDurationSec` can no longer be bypassed with a misleading mimetype: the OGG duration is read whenever the bytes start with `OggS`, whatever mimetype the sender declares (`audio/mpeg`, `video/mp4`, a value with line breaks...). Before, only declared OGG mimetypes were checked and the paid STT call went ahead. `estimateDurationSec` from `@botmesh/voice/internal` no longer takes a mimetype.
- 673ba81: Harden `@botmesh/voice`: a per-call `timeoutMs` on `transcribe`/`synthesize` is now honoured (it can only tighten `limits.timeoutMs`); `limits` are validated at `plug()` with a `VoiceConfigError` naming the field (an `Infinity`, `0`, negative or `NaN` `timeoutMs` used to time out at once) and `client.limits` is frozen; Deepgram no longer sends an inbound mimetype with line breaks or garbage as `Content-Type` (it made the whole transcription fail); `sk_…` keys are redacted from service error details like `sk-…`; `Uint8Array` audio is accepted; a throwing `autoTranscribe.filter` / `autoReplyWithVoice.filter` is logged and skips instead of dropping the message or failing the send.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
