# @botmesh/meta

## 1.0.0-beta.2

### Patch Changes

- 591b510: `CloudAPIProvider.ingest()` and `MessengerProvider.ingest()` answer `503` while the provider is stopped (after `bot.stop()`, until the next `bot.start()`), like `@botmesh/instagram` and `@botmesh/telegram`. Before, a webhook that arrived while the bot was stopped was acknowledged with `200` and the message was lost; now Meta delivers it again after the restart.
- Updated dependencies [591b510]
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/graph-core@1.0.0-beta.2
  - @botmesh/core@2.0.0-beta.4

## 1.0.0-beta.1

### Major Changes

- 79af076: First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).

### Minor Changes

- ac11ddf: One rule for unsupported operations, and bounded waits.
  
  **Breaking:** an operation the transport cannot perform is now absent (the optional `IProvider` method is not defined and its capability flag is `false`) instead of a silent no-op:
  
  - `@botmesh/meta`: `CloudAPIProvider#typing()` and `#deleteMessage()` are removed (they did nothing).
  - `@botmesh/telegram`: `TelegramProvider#markRead()` is removed (bots get no read receipts; it did nothing).
  - `@botmesh/core/testing`: `MockProvider` reports `capabilities.typing` / `readReceipts` as `true` only when a `typing()` / `markRead()` method exists (a subclass or a test that adds one gets the flag; assigning the flag still overrides it). Before, both were `true` with no method behind them, which every `ctx` helper already treated as unsupported.
  
  `ctx.typing()`, `ctx.markRead()` and `ctx.delete()` stay no-ops on those channels. New `checkCapabilityContract` / `assertCapabilityContract` (and `CapabilityContractError`) in `@botmesh/core/testing` check that a provider's capability flags agree with its methods and that its text limits are valid.
  
  Also:
  
  - `RateLimitedError.retryAfterMs` is capped at 24 h, so no wait built on it overflows `setTimeout` (which fires at once past ~24.8 days).
  - `@botmesh/telegram`: a 429 `retry_after` is clamped (missing/invalid → 1 s, at most 24 h); a huge value used to make the poll loop spin.
  - `@botmesh/meta`: a local media path that cannot be read rejects with `UnsupportedContentError` (the fs error as `cause`) instead of a raw `ENOENT`.
- ac11ddf: `timestamp` is epoch milliseconds on every channel.
  
  **Breaking:** `InboundMessage.timestamp`, `InboundInteraction.timestamp`, `DeliveryStatus.timestamp` and `ctx.timestamp` are epoch **milliseconds** everywhere. `@botmesh/baileys`, `@botmesh/meta` and `MockProvider` (`@botmesh/core/testing`) used to emit epoch seconds; drop any `* 1000` in your code (`new Date(ctx.timestamp)` is now right).
  
  - A missing or invalid transport time is the receive time (`Date.now()`), never `0` (Baileys and the Cloud API emitted `0`).
  - `@botmesh/telegram`: a callback query (button press) carries the receive time; the Bot API sends no press time and the date of the message holding the keyboard could be days old.
  - `@botmesh/core` still converts a value below `1e12` from a third-party provider that emits seconds, for `ctx.timestamp` and the message log (soft path), and the message log keeps the receive time for a second-precision stamp of the current second whether it arrives in seconds or ms.
  - New contract helpers in `@botmesh/core/testing`: `checkInboundContract` / `assertInboundContract` (and `InboundContractError`) check epoch-ms timestamps, `respondBy`, `body`, `mentions` and the message type of a provider's events.
- ac11ddf: Long text is split into several messages automatically.
  
  **Breaking (behaviour):** a `text` send longer than the provider's `capabilities.maxTextLength` (UTF-16 code units) or the new `capabilities.maxTextBytes` (UTF-8 bytes) is no longer passed to the provider whole (which rejected it with `PayloadTooLargeError` on Telegram, Discord, Messenger and Instagram): the core sends it as several messages, in order. Set `new Bot({ splitLongText: false })` to keep the old behaviour.
  
  - Cuts land on the most natural boundary that fits (paragraph, line, sentence, word) and never inside a grapheme (surrogate pairs, ZWJ emoji sequences, flags, skin tones) or the chat's markup: links and URLs stay whole; a fenced code block, inline code, an emphasis run or an HTML element longer than the limit is closed at the end of a part and reopened at the start of the next (the fence keeps its language).
  - `before('send')` hooks run once on the whole text, and what they return is split: a footer or a translation applies to the whole message and every part still fits (a hook that makes a short text too long gets it split too, its explicit key suffixed from `#1`); an `abort()` skips the whole text. Each part is then a send of its own: `after('send')` hooks, the message log and the durable outbox see each part. Only the first part keeps `options.quoted`; an explicit `idempotencyKey` gets a `#2`, `#3`… suffix from the second part on. A failing part rejects the send and the rest is not sent.
  - Durability: when the outbox defers a part (`SendDeferredError`), the parts after it are journaled behind it, so the sweeper delivers every part, in order. `bot.enqueue()` splits too, into one record per part (`key`, `key#2`, …).
  - The splitter runs in linear time: the markup of a text is scanned once, with no pattern that rescans to the end of the line for an unclosed `_`, `*`, `[` or tag.
  - `SendResult` / `SentMessage` gain `parts?: MessageRef[]` (every part, in order; `ref` is the last one).
  - New `ProviderCapabilities.maxTextBytes`; `MockProvider` takes a `maxTextBytes` option. `ctx.stream()` honours it too.
  - `splitMessage(text, limit)` and `findSplitPoint(text, limit)` accept `{ maxLength?, maxBytes?, format? }` (new exported type `SplitTextOptions`) as well as a plain length.
  - `@botmesh/meta`: the Cloud API provider declares `maxTextLength: 4096` (its `text.body` limit), so longer text is split instead of failing at Graph.
- 50fb2b6: **Breaking (behaviour):** one policy for presence hints while the transport is disconnected. `ctx.typing()`, `ctx.recording()`, `ctx.markRead()` and the automatic typing indicator are best-effort: while the provider's last connection state is not `'ready'`, or once the bot is stopped, the bot does not call the provider; the hint resolves, is logged at debug and counted in the new `metrics().presenceSkipped` (`{ typing, markRead }`, `botmesh_presence_skipped_total{kind}` in `toPrometheus()`). The rule is part of the `IProvider` contract ("PRESENCE WHILE DISCONNECTED"); Baileys, the Cloud API and Telegram (and the other built-in channels) follow it when called directly too: `markRead()` / `typing()` resolve without contacting the transport while not connected. New `checkPresenceWhileDisconnected` / `assertPresenceWhileDisconnected` in `@botmesh/core/testing`.
- d43e55c: **Breaking (default): Graph API v26.0.** The Meta providers now call Graph API `v26.0` by default (it was `v21.0`, which Meta retires on 2027-01-21). The default lives in the new `DEFAULT_GRAPH_API_VERSION` export of `@botmesh/graph-core` and follows Meta's current version; the send and webhook payloads the providers use did not change between v21.0 and v26.0. Pass `apiVersion` to stay on a version (`apiVersion: 'v21.0'` restores the previous behaviour).
  
  - `@botmesh/meta`: WhatsApp's `played` status (a voice note was listened to) is now reported as a `read` status with `platformData.played: true`; it used to be dropped. Statuses without the `conversation` object (Graph v24.0+) keep working.
- 9bb285a: **Breaking:** `toFlowJson()` and `publishForm()` default the WhatsApp Flow submit label to the core default locale, English (`'Submit'`); it was Spanish (`'Enviar'`) while the core already defaulted to English. The fallbacks of `toFlowMessage()` for a bare definition sent without a bot context follow (`'Open form'`, `'Fill in the form.'`). Pass `lang: 'es'` (`toFlowJson(def, { lang: 'es' })`, `publishForm(def, { flowJson: { lang: 'es' } })`) or set `submitLabel` to keep the Spanish label. See the "Migrating to 2.0" guide.
- 7bccf89: New `lang` option on `CloudAPIProvider`: the language of the default submit label `publishForm()` bakes into a WhatsApp Flow (default `'en'`, the core default; set it to your `BotConfig.lang`). `publishForm(def, { lang })` overrides it per Flow and `flowJson.lang` still wins over both. `phoneNumberId` is typed `string | number` (a safe integer was already accepted at run time). Deprecated, removal planned for v3: `toProviderError` (use `toGraphError` from `@botmesh/graph-core`), `GraphClient`, the re-exported `verifyChallenge`/`verifySignature` and the `debug` option.
- b342cf6: Release hardening of `CloudAPIProvider`:
  
  - New `requestTimeoutMs` option (default `60000`): every Graph request (send, upload, mark read, media lookup) now rejects with a `ProviderError` when it takes longer, instead of hanging the send forever.
  - The constructor fails fast, naming the field, when `accessToken`, `phoneNumberId` or `verifyToken` is missing or empty.
  - **Behavior change (bug fix):** more than 3 reply buttons now reject with `UnsupportedContentError` instead of silently dropping the extra options; send a list instead. Button, list and section titles are cut on characters (never inside an emoji) and list row descriptions are capped at 72 characters.
  - Malformed webhook fields never reach the bot with the wrong type: bodies, captions and emoji are strings, media fields are strings or absent, and timestamps are finite (`0` when malformed).
  - The media id is URL-encoded in the Graph path, `UnsupportedContentError.kind` names the real media kind, the poll error is in English, and `SessionWindowReopenedError` no longer puts the phone number in its message (it stays on `.chatId`).
- 9ec7a82: Fixes for the low-severity defects left open by the alpha exit review:
  
  - An interactive webhook reply that is not a button or list press (for example `call_permission_reply`) was emitted as a `button` interaction with empty data. It now arrives as an `unknown` message with the raw payload in `ref.native`.
  - Graph's interactive limits are checked before sending, with an `UnsupportedContentError` that says what to change: a `buttons`/`card` with no button, repeated button ids or titles (compared after the 20-character cut), a list with no rows, more than 10 rows in total or repeated row ids.
  - Interactive labels are cut on grapheme boundaries (never more code points than Graph allows): an emoji ZWJ sequence or a flag is kept whole or dropped, never split into another symbol.
  - A failed status' `errors[0]` is checked: `code` is kept only when it is a number (a digit string is converted) and the text only when it is a string, clipped to 1000 characters.
  - New `uploadTimeoutMs` option (default 5 minutes, or `requestTimeoutMs` when larger) for media uploads, which can be up to 100 MB; `requestTimeoutMs` (60 s) no longer cuts them.
  - `phoneNumberId` may be a safe positive integer again (it is used as a string); other numbers still fail with an error naming the field.
  
  What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
- c60603f: Session-window API stability: what an app configures and queries (`SessionWindowManager` constructor, `forScope`, `state`, `isOpen`, `expiresAt`, `pending`, `clearPending`; `SessionWindowOptions`; `SessionWindowStore` and `MemorySessionWindowStore`; the report and reopen types; `SessionWindowReopenedError`; the constants) stays public and covered by semver. The hooks the provider drives (`SessionWindowManager.send`, `noteInbound`, `noteFailedStatus`) and the `RawSend` type are now `@experimental` and may change in a minor release. No runtime change. The provider calls graph-core's `checkGraphSignature` with the new options object.

### Patch Changes

- 54ebba3: README rework for the stable line: one structure (what it is, install, quick start, options, errors, links), a single note about the prerelease dist-tag instead of hard-coded `@alpha` commands, no stale "alpha/experimental" banners, English examples and canonical option names only. Fixes wrong samples: `secureFetch` resolves `{ url, response, body }` with the body already read (the old sample called `response.json()`), the Meta webhook sample keeps the raw body with `express.raw()` (no `any` casts), the Meta pricing sample was not valid TypeScript, and the Redis Cluster sample passes `rootNodes` as URL strings. Documents the previously missing exports (`assertSafeTarget`, `isAllowedHostUrl`, `isPrivateAddress`, `graphRequest`, `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`) and the errors users hit (pnpm build scripts, `better-sqlite3` on Node.js 24.19, Graph `190`/`100`/`131030`, Telegram `404`).
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
- d038a99: Cards and URL buttons no longer lose content silently on the Cloud API:
  
  - A `Button` with `url` goes out as a native `cta_url` link button (label cut to 20 characters) instead of a reply button without the link. Graph allows one per message, so several URL buttons, or a URL button mixed with reply buttons, reject with `UnsupportedContentError`.
  - A `card` keeps its `imageUrl` (an image message with the title and body as caption, or the header of the interactive message) and its `buttons` (native reply or `cta_url` buttons).
  - **Behavior change (bug fix):** a card with more than 3 buttons, or with a mix of links and replies, now rejects with `UnsupportedContentError` instead of going out as plain text without them.
- ee49c56: Import the backend and transport helpers (`toInboundLocation`, `messageKey`, `KvDurability`, the schedule and form helpers, `I18n`) from the new `@botmesh/core/spi` subpath, so these packages need the `@botmesh/core` version that ships it. No behaviour change. The doc examples use `durability: { backend }` (`journal` is its deprecated name).
- Updated dependencies [ac11ddf]
- Updated dependencies [ac11ddf]
- Updated dependencies [ac11ddf]
- Updated dependencies [50fb2b6]
- Updated dependencies [473728a]
- Updated dependencies [088c920]
- Updated dependencies [b4c298d]
- Updated dependencies [c03fb3c]
- Updated dependencies [a448242]
- Updated dependencies [a7992c3]
- Updated dependencies [0864a3b]
- Updated dependencies [a998e70]
- Updated dependencies [50fb2b6]
- Updated dependencies [50fb2b6]
- Updated dependencies [473728a]
- Updated dependencies [511589e]
- Updated dependencies [9bb285a]
- Updated dependencies [88c0fef]
- Updated dependencies [59a09d1]
- Updated dependencies [473728a]
- Updated dependencies [0c0d203]
- Updated dependencies [50fb2b6]
- Updated dependencies [ee49c56]
- Updated dependencies [2ff24f5]
- Updated dependencies [50fb2b6]
- Updated dependencies [b9a9d6a]
- Updated dependencies [d43e55c]
- Updated dependencies [2c9bfb4]
- Updated dependencies [a2c946a]
- Updated dependencies [54ebba3]
- Updated dependencies [5ad624e]
- Updated dependencies [79af076]
- Updated dependencies [51486ac]
- Updated dependencies [d038a99]
- Updated dependencies [db6c410]
- Updated dependencies [c60603f]
- Updated dependencies [949f9fa]
- Updated dependencies [f4b0623]
- Updated dependencies [c60603f]
- Updated dependencies [bf5f3f1]
- Updated dependencies [28e8b2b]
  - @botmesh/core@2.0.0-beta.3
  - @botmesh/graph-core@1.0.0-beta.1
  - @botmesh/http@1.0.0-beta.1

## 0.2.0-alpha.0

### Minor Changes

- 0a2291f: `CloudAPIProviderConfig.logger` takes any core `LoggerLike` (pino, `console` or a `{ debug, info, warn, error }` object), not only pino's `Logger`.
- 9b97391: Inbound locations fill the normalized `InboundMessage.location` (`ctx.sharedLocation`): Baileys `locationMessage` and `liveLocationMessage` (`live: true`; a live location's body is now its caption), Cloud API `location`, Telegram `location` (live when `live_period` is set) and `venue` (its title becomes the body; new `TelegramVenue` type).
- f25b2af: Durable media references, so a replayed inbound message can still download its media. `IProvider` gains two optional hooks: `serializeMediaRef(ref)` returns a JSON-safe, versioned `{ v, data }` (or `undefined`), and `rehydrateMediaRef(stored, ref)` rebuilds the `MediaRef`. With `BotConfig.durability` on, the inbox journals that reference instead of the live media token. A replay (crash recovery, background retry, operator `replayInbound`) rebuilds it inside the chat's turn, so per-chat order is kept. When the media cannot be rebuilt, the message still runs and only its download fails: `loadMediaOf(ctx, { throwOnError: true })` rejects with the new `MediaUnavailableError` (a `ProviderError` whose `reason` is `'not-durable'`, `'provider-mismatch'` or `'rehydrate-failed'`). `durability.inbox.mediaRefs: false` keeps the previous encoding. A provider without the hooks, and records written before this change, behave exactly as before. New exports: `MediaUnavailableError` and the `SerializedMediaRef` and `MediaUnavailableReason` types.
  
  The providers implement the hooks. Baileys journals only the media content (CDN url, direct path, media key and hashes; no thumbnail, caption or quoted context) plus the message key that re-upload requests need. It skips view-once media unless `durableMedia: { viewOnce: true }` is set, and it returns the cached original message while it is still in memory. Cloud API journals the media id and Telegram the `file_id`. None of them journals credentials, and each validates the stored value when it reads it back.
- 2232f88: Native form labels follow the user's language. `ctx.form()` / `flow().form()` fill a missing `cta`, `submitLabel` and (without `intro`/`title`) body from the new `core.form.cta`, `core.form.submit` and `core.form.body` catalog entries (`es`/`en`) in `ctx.lang`, through the exported `withFormDefaults()`. `@bot-wa/meta` no longer hard-codes Spanish: its fallbacks use the same catalog and `toFlowJson(def, { lang })` (also `publishForm(def, { flowJson: { lang } })`) picks the language of the published Flow's default submit label (default `'es'`, unchanged).
- 522bcca: Support WhatsApp usernames / BSUIDs: parse every business-scoped user id field, keep one stable id per person (phone when known, else BSUID), learn phone ↔ BSUID pairs through a pluggable `identityMap` (`MemoryIdentityMap`), send to BSUIDs via `recipient`, expose `isBsuid()`, and drop events without usable ids instead of emitting `undefined` ids.
- 27620ef: Add a WhatsApp Cloud API 24 h customer-service window manager (`sessionWindow` option, `SessionWindowManager`, pluggable `SessionWindowStore`): reopen closed chats with an approved template and retry the original send when the user replies. Status events now carry the normalized `pricing`/`conversation` objects in `DeliveryStatus.platformData` (new optional field in core), and `provider.usage` aggregates per-chat/per-category usage and estimated cost. Window state is scoped per business number (`phoneNumberId`; shared managers via `forScope()`), and media is uploaded once before queueing so retries never re-read a drained stream or keep media bytes in memory.
- 4fc0560: Add native forms: `flow().form(definition, opts)` collects typed fields (text, number, email, date, select, multiselect, opt-in) with validation. Providers with the new `capabilities.forms: 'native'` receive an `OutboundContent` of kind `'form'` and reply with `'form'` inbound messages (`formReplyBody()` / `parseFormReply()`); every other provider gets field-by-field questions. `describe()` draws `form` nodes and `lint()` checks their timeouts and `c.state` key collisions. `@bot-wa/meta` renders forms as static WhatsApp Flows (`toFlowJson`, `toFlowMessage`, `publishForm()`, `config.flows`) and turns `nfm_reply` webhooks into form replies. Other providers reject the `form` kind with `UnsupportedContentError`. The new optional `IProvider.canRenderForm(form, { nativeId })` (exposed as `ctx.canRenderForm()`) lets a native provider say it has no native form for a definition; `CloudAPIProvider` implements it, so a form without a mapped Flow is asked field by field without first sending (and failing) a form message. Ambiguous grouped numbers (`1.500`, `1,500`) are rejected instead of being read as 1.5.

### Patch Changes

- 397c2be: Export types referenced by public signatures: `WAMediaUpload` and `DisconnectAction` (`@bot-wa/baileys`, whose `ChatId`/`UserId` are now core's), `GraphClientConfig` (`@bot-wa/meta`), and `TelegramMessageEntity`, `TelegramPhotoSize`, `TelegramLocation`, `TelegramContact`, `TelegramPoll` (`@bot-wa/telegram`).
- 7b00477: `@bot-wa/core`: new optional `ProviderCapabilities.textFormat` (`TextFormat`: `'whatsapp' | 'markdown' | 'html' | 'plain'`), the rich-text dialect a channel renders, so Markdown producers (e.g. `@bot-wa/ai`) can convert their text. `MockProvider` accepts `textFormat`.
  
  `@bot-wa/baileys` and `@bot-wa/meta` declare `textFormat: 'whatsapp'`; `@bot-wa/telegram` declares `'plain'` (text is sent without `parse_mode`).
- 1cc2146: A send rejected with `131051` (unsupported message type) or `131062` (BSUID recipient not supported) now reports the kind that was actually sent in `UnsupportedContentError.kind`, instead of the generic `'native'` / `'template'` fallback. `GraphClient.sendMessage` takes the content kind as an optional third argument.
- aa70898: Deprecate the unused `GraphErrorBody` type export (Graph responses go through `readGraphResponse()` from `@bot-wa/graph-core`); `GraphSendMessageResponse['error']` keeps the same shape.
- 7d00f20: - `ingest()` answers `400` for a body that is not a JSON object instead of throwing.
  - Template quick-reply buttons (`type: 'button'`) arrive as `button` interactions carrying the button `payload` (they were `unknown` messages with an empty body).
  - Replies expose the quoted message as `quoted.ref` (its `wamid`).
  - Statuses other than `sent` / `delivered` / `read` / `failed` (e.g. `deleted`, `warning`) are dropped instead of being reported as `failed`, which also kept them from triggering session-window fallbacks.
  - Location and contact messages get a readable `body`.
  - Buffer / stream / path media are uploaded with a real MIME type (document `mimetype`, file extension, magic bytes, then a per-kind default) instead of `application/octet-stream`, which the Cloud API rejects for images, audio, video and stickers; documents keep their `filename` in the upload.
  - Requests that never get a response (DNS, TLS, reset) reject with a `ProviderError`, including the media CDN download, where an SSRF refusal or timeout is a `ProviderError` and an oversized file a `PayloadTooLargeError`.
- ce7790f: Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
- efb1fa6: Native streaming of long/AI replies with `ctx.stream(source, opts)`. The strategy comes from the new `ProviderCapabilities.streaming` field (`'draft' | 'edit' | 'none'`): native drafts (Telegram `sendMessageDraft`, with `can_stop`/`keep_on_stop`), throttled message edits (Discord, Telegram groups) or sentence chunks with typing (WhatsApp). Updates are throttled, cancellation is supported (`signal`, the user's stop button) and no message exceeds `maxTextLength`. New exports: `streamText`, `resolveStreamStrategy`, `splitMessage`, `findSplitPoint` and their types; `IProvider.sendDraft`; `MockProvider({ streaming })`. `@bot-wa/ai` gains `AIClient.streamReplyInChat()` and the `stream` option for the autoresponder. The Telegram long-poll now also asks for `stopped_message_generation` updates. Live edits and drafts run the `before('send')` hooks (payload `stream: 'draft' | 'edit'`) and the message log keeps the final edited text; rate-limited edits back off for `retryAfterMs`; `onCancel: 'discard'` deletes the live message when the transport can. The streamed autoreply honours refusals (`refusalMessage`, not stored), replies `errorMessage` on an empty answer and, with `onCancel: 'discard'`, keeps a cancelled answer out of the context.
- Updated dependencies [2e16743]
- Updated dependencies [397c2be]
- Updated dependencies [0a2291f]
- Updated dependencies [ddfb1e9]
- Updated dependencies [ee5777c]
- Updated dependencies [522bcca]
- Updated dependencies [588fa34]
- Updated dependencies [a33cb08]
- Updated dependencies [909fa96]
- Updated dependencies [9cb6621]
- Updated dependencies [99251ef]
- Updated dependencies [7cc66b2]
- Updated dependencies [39a8149]
- Updated dependencies [31fcc2e]
- Updated dependencies [40fdab4]
- Updated dependencies [4bbd0ad]
- Updated dependencies [f8c1d4f]
- Updated dependencies [231cbd2]
- Updated dependencies [ca25eb7]
- Updated dependencies [18958c6]
- Updated dependencies [40ec0bd]
- Updated dependencies [fd07c8c]
- Updated dependencies [0149d66]
- Updated dependencies [9c94d93]
- Updated dependencies [08a933f]
- Updated dependencies [1a81406]
- Updated dependencies [64fb59f]
- Updated dependencies [2549ffe]
- Updated dependencies [a4e9429]
- Updated dependencies [310db8d]
- Updated dependencies [2bab262]
- Updated dependencies [6ea4442]
- Updated dependencies [136caa5]
- Updated dependencies [634993f]
- Updated dependencies [b866fbd]
- Updated dependencies [c6a4292]
- Updated dependencies [7b00477]
- Updated dependencies [6504335]
- Updated dependencies [ce42173]
- Updated dependencies [1984f6f]
- Updated dependencies [522bcca]
- Updated dependencies [02a21cc]
- Updated dependencies [23371fb]
- Updated dependencies [9b97391]
- Updated dependencies [f25b2af]
- Updated dependencies [2232f88]
- Updated dependencies [522bcca]
- Updated dependencies [9ec06c8]
- Updated dependencies [8854c8e]
- Updated dependencies [b0034aa]
- Updated dependencies [1cc2146]
- Updated dependencies [c5f5090]
- Updated dependencies [1af5d4c]
- Updated dependencies [9ec06c8]
- Updated dependencies [27620ef]
- Updated dependencies [e4574e6]
- Updated dependencies [ce7790f]
- Updated dependencies [b95b523]
- Updated dependencies [5196990]
- Updated dependencies [2c4f9f0]
- Updated dependencies [efb1fa6]
- Updated dependencies [f8c1d4f]
- Updated dependencies [4fc0560]
  - @bot-wa/core@2.0.0-alpha.2
  - @bot-wa/graph-core@0.2.0-alpha.0
  - @bot-wa/http@0.2.0-alpha.0
