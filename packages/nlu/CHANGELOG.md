# @botmesh/nlu

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

- 618502b: Matching and validation fixes before the first release:
  
  - Confidence stays within `[0, 1]`: a word repeated in an utterance (`'no no no'`) counts once, so it no longer scores above 1, and a word or phrase repeated in the input (`'hola hola'`) lowers the score instead of reaching 1, so it never ties or beats an exact match of another intent.
  - `contains` only counts whole words (`my order` is no longer found in `my orders`).
  - Normalization folds full-width letters and ligatures (NFKD), strips Hebrew points and Arabic harakat like Latin accents, removes invisible format characters (zero-width spaces, soft hyphens) instead of splitting the word, and keeps the vowel signs of scripts such as Devanagari or Thai inside their word.
  - `define()` throws, leaving the intent unchanged, on a phrase with no letters or digits (emoji or punctuation only: it could never match), a non-string entry (it was dropped silently), a slot name used twice, the reserved slot name `__proto__`, and slots glued only by a character that normalization removes.
  - `match()` / `rank()` throw a clear `TypeError` for a non-string text; `whenIntent()` throws a clear `TypeError` for a missing engine (for example `bot.injectTools.nlu` before plugging `nluPlugin`), an empty intent or a non-function handler.
  - The engine remembers the scores of the last text, so the predicate and handler of every `whenIntent` on one engine score a message once instead of twice per registered intent. `rank()` returns copies.
  - `nluPlugin` removes `ctx.tools.nlu` when unplugged and rejects an `intents` value that is not a plain object.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
