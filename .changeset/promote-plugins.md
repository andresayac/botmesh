---
"@botmesh/rag": major
"@botmesh/voice": major
"@botmesh/nlu": major
"@botmesh/dialogflow": major
"@botmesh/chatwoot": major
"@botmesh/tickets": major
"@botmesh/moderation": major
---

First public release. These plugins were private workspace packages; they now ship to npm with the beta and their API is frozen and covered by semver from 1.0.0. Each package keeps on its main entry what an application needs and moves its building blocks to a new `/internal` entry, without a semver guarantee (`@botmesh/nlu` has no internal entry):

- `@botmesh/rag/internal`: `splitMarkdownSections`, `MarkdownSection`, `resolveChunkOptions`, `cosine`, `hashText`, `tokenize`, `resolveEmbedder`, `createPdfParser`. `SUPPORTED_EXTENSIONS` is frozen.
- `@botmesh/voice/internal`: `trimPunctuation`, `resolveStt`, `resolveTts`, `OPENAI_TTS_MIMETYPES`, `elevenLabsMimetype`, `estimateOggDurationSec`, `estimateDurationSec`, `sniffMimetype`. `DEFAULT_VOICE_LIMITS` and `OPENAI_TTS_MIMETYPES` are frozen.
- `@botmesh/dialogflow/internal`: `normalizeEsResult`, `normalizeCxResult`, `toSessionId`, `parseCredentials`, `createServiceAccountJwt`, `DIALOGFLOW_SCOPE`, `DEFAULT_TOKEN_URI`. `dialogflowPlugin` is the canonical name; `dialogflowContext` stays as a `@deprecated` alias of the same function.
- `@botmesh/chatwoot/internal`: `ChatwootMapping`, `verifyWebhook`, `WebhookAuthConfig`, `inboundText`, `outboundText` (`chatwootPlugin().handleWebhook` and `webhookHandler` keep verifying every delivery). `handleWebhook({ query })` accepts `URLSearchParams` or any parsed query object such as Express `req.query`; only a string `token` is read.
- `@botmesh/tickets/internal`: `renderTemplate`, `localClock`. `TICKET_PRIORITIES` and `TICKET_STATUSES` are frozen.
- `@botmesh/moderation/internal`: `findLinks`, `findInviteLinks`, `InviteLink`, `compileTerms`, `foldText`, `CompiledTerm`. `GroupAdminApi` and `ModerationProvider.groups` stay on the main entry but are `@experimental` (outside semver) until `@botmesh/core` defines a groups capability for providers.
