# @botmesh/chatwoot

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

- 6a232e1: Fixes found testing against a self-hosted Chatwoot 4.7:
  
  - Contacts are looked up by exact `identifier` through the contacts filter API. The paginated substring search could miss the chat's contact (15 per page), and recreating it failed with 422 "Identifier has already been taken" for every message of that chat.
  - A lost mapping (new store, restart on `MemoryStore`) re-links the chat to its contact's existing contact inbox and newest conversation in the inbox, instead of opening a second one where agent replies went nowhere.
  - A message refused with 422 because Chatwoot is still deleting the contact's conversation is re-sent to a new conversation instead of being lost, also when Chatwoot answers the follow-up `GET /conversations/:id` with 500 instead of 404 (only together with its nil-contact 422).
  - An agent reply the channel refuses is marked `failed` in Chatwoot, with the error name, so the agent sees it.
  - Clearer mistakes: an `http://` `baseUrl` without `http.allowHttp` throws at construction, a blocked private host names `http.allowPrivateHosts`, a parsed (non-raw) webhook body reports how to fix it, and plugging one instance into two bots throws.
  - `ChatwootApiError` no longer carries the query string (which held the chat id) in its message or `path`.
  - New client methods `listContactConversations`, `getConversation` and `updateMessageStatus`, and the types `ChatwootConversationRef` and `ChatwootMessageStatus`.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
