# @botmesh/telegram

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
- 50fb2b6: **Breaking (behaviour):** one policy for presence hints while the transport is disconnected. `ctx.typing()`, `ctx.recording()`, `ctx.markRead()` and the automatic typing indicator are best-effort: while the provider's last connection state is not `'ready'`, or once the bot is stopped, the bot does not call the provider; the hint resolves, is logged at debug and counted in the new `metrics().presenceSkipped` (`{ typing, markRead }`, `botmesh_presence_skipped_total{kind}` in `toPrometheus()`). The rule is part of the `IProvider` contract ("PRESENCE WHILE DISCONNECTED"); Baileys, the Cloud API and Telegram (and the other built-in channels) follow it when called directly too: `markRead()` / `typing()` resolve without contacting the transport while not connected. New `checkPresenceWhileDisconnected` / `assertPresenceWhileDisconnected` in `@botmesh/core/testing`.
- b1b6255: Release-readiness hardening of the Telegram provider:
  
  - `stop()` now returns at once even while the poll loop waits out a `retry_after` or an error backoff (the wait is aborted and its timer cleared).
  - `ready` no longer waits up to a full idle `pollTimeout`: the first `getUpdates` round uses `timeout: 0`.
  - New `requestTimeoutMs` option (default 120000): every Bot API request has a client timeout; long polls get `pollTimeout` + up to 15 s, so a half-open connection can no longer silence the bot forever.
  - Network failures reject with a `ProviderError` (method name + redacted cause) instead of a raw `TypeError`, and no error message, `cause` or log line carries the bot token (Node's fetch errors can quote the request URL).
  - The inbound normalizer type-checks every field: a malformed or hostile Update is skipped and logged (without its content) instead of throwing into the poll loop or the host's webhook route; `ingest()` answers 200 for it. A `null` or non-object entry in a `getUpdates` batch is skipped too, so it can no longer wedge the poll loop on the same batch.
  - `ingest()` accepts the raw body as `Buffer`/`Uint8Array` (the `@botmesh/server` default) and reads the secret header in any case, from plain objects or Fetch `Headers` (new exported type `TelegramWebhookHeaders`).
  - Group commands addressed to this bot (`/menu@MyBot`) reach `bot.command('menu')`; new `username` option for when `selfId` skips `getMe`. `parseUpdate()` takes an optional third `botUsername` argument.
  - Clearer configuration errors: a missing token, a non-http(s) `baseUrl` or negative/non-numeric timings throw a `TypeError` from the constructor; a media string that is neither a URL nor a readable file explains how to reuse a `file_id` (`{ native }`), with the right content kind.
  - Inline-keyboard button text is cut on code points (no half emoji).
- 7bccf89: `pollTimeoutMs` (milliseconds, sent to `getUpdates` in whole seconds) replaces `pollTimeout` (seconds), which stays as a deprecated alias; setting both to different values throws. The error mapper is now `toTelegramError` (`toProviderError` is a deprecated alias), the `debug` option is deprecated in favour of `logger`, and the wire helpers `parseUpdate`, `toOutbound` and `MEDIA_UPLOAD` are labelled `@experimental`.
- 4b0ee6c: Fixes for the low-severity defects left open by the alpha exit review:
  
  - Webhook mode: `ingest()` after `stop()` answers `503` and emits nothing (before, Updates kept reaching a stopped bot); Telegram redelivers them after the restart. A `start()` that races `stop()` (stop while `getMe` is in flight) no longer emits `ready` after `closed`.
  - `/menu@MyBot` at the start of a photo or document caption reaches `bot.command('menu')`, like in a text message.
  - A 429 `retry_after` is capped at 24 h (a huge value overflowed the timer and retried at once), and a negative or non-numeric one means 1 s.
  - New `uploadTimeoutMs` option (default 5 minutes, or `requestTimeoutMs` when larger) for file uploads; `requestTimeoutMs` no longer cuts a slow upload.
  - At most 1000 draft stop callbacks (`sendDraft(..., { onStop })`) are kept, dropping the oldest, so a burst of drafts cannot grow the map within its 10-minute TTL.
  
  What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
- 7bccf89: **Breaking:** polls are sent non-anonymous (`is_anonymous: false`) so their votes reach the bot: each `poll_answer` update becomes a `'poll'` event with the same shape as `@botmesh/baileys` (`vote.ref` is the poll message, `vote.senderId` the voter, `vote.options` the tally with `voters`; an empty pick withdraws the vote). Votes are tallied for the 500 most recent polls this process sent. Members of the chat can see who voted. Channels do not allow public-voter polls: a poll to a channel is retried once as anonymous (its votes never reach the bot) and that channel gets anonymous polls from then on. An explicit `platformData.is_anonymous` is never changed; `anonymousPolls: true` keeps anonymous polls (no votes), and `platformData: { is_anonymous: true }` does it for one send. Long polling now also requests `poll_answer`. New `parsePollAnswer()` wire helper and `TelegramPollAnswer` type.

### Patch Changes

- 54ebba3: README rework for the stable line: one structure (what it is, install, quick start, options, errors, links), a single note about the prerelease dist-tag instead of hard-coded `@alpha` commands, no stale "alpha/experimental" banners, English examples and canonical option names only. Fixes wrong samples: `secureFetch` resolves `{ url, response, body }` with the body already read (the old sample called `response.json()`), the Meta webhook sample keeps the raw body with `express.raw()` (no `any` casts), the Meta pricing sample was not valid TypeScript, and the Redis Cluster sample passes `rootNodes` as URL strings. Documents the previously missing exports (`assertSafeTarget`, `isAllowedHostUrl`, `isPrivateAddress`, `graphRequest`, `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`) and the errors users hit (pnpm build scripts, `better-sqlite3` on Node.js 24.19, Graph `190`/`100`/`131030`, Telegram `404`).
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
- 1cd6056: An inbound photo now carries `media.mimetype: 'image/jpeg'`. Telegram re-encodes every photo as JPEG and sends no `mime_type` for it, so `loadMediaOf(ctx)` reported `application/octet-stream` for photos.
- ee49c56: Import the backend and transport helpers (`toInboundLocation`, `messageKey`, `KvDurability`, the schedule and form helpers, `I18n`) from the new `@botmesh/core/spi` subpath, so these packages need the `@botmesh/core` version that ships it. No behaviour change. The doc examples use `durability: { backend }` (`journal` is its deprecated name).
- dbf6b59: A 404 from the Bot API (a malformed bot token, or a `baseUrl` with the wrong path) now rejects with `Not Found — check the bot token and baseUrl` instead of a bare `ProviderError: Not Found`. The token is never echoed.
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
- Updated dependencies [2c9bfb4]
- Updated dependencies [a2c946a]
- Updated dependencies [54ebba3]
- Updated dependencies [5ad624e]
- Updated dependencies [79af076]
- Updated dependencies [949f9fa]
- Updated dependencies [f4b0623]
- Updated dependencies [c60603f]
- Updated dependencies [28e8b2b]
  - @botmesh/core@2.0.0-beta.3
  - @botmesh/http@1.0.0-beta.1

## 0.2.0-alpha.0

### Minor Changes

- 0a2291f: `TelegramProviderConfig.logger` takes any core `LoggerLike` (pino, `console` or a `{ debug, info, warn, error }` object), not only pino's `Logger`.
- 9b97391: Inbound locations fill the normalized `InboundMessage.location` (`ctx.sharedLocation`): Baileys `locationMessage` and `liveLocationMessage` (`live: true`; a live location's body is now its caption), Cloud API `location`, Telegram `location` (live when `live_period` is set) and `venue` (its title becomes the body; new `TelegramVenue` type).
- f25b2af: Durable media references, so a replayed inbound message can still download its media. `IProvider` gains two optional hooks: `serializeMediaRef(ref)` returns a JSON-safe, versioned `{ v, data }` (or `undefined`), and `rehydrateMediaRef(stored, ref)` rebuilds the `MediaRef`. With `BotConfig.durability` on, the inbox journals that reference instead of the live media token. A replay (crash recovery, background retry, operator `replayInbound`) rebuilds it inside the chat's turn, so per-chat order is kept. When the media cannot be rebuilt, the message still runs and only its download fails: `loadMediaOf(ctx, { throwOnError: true })` rejects with the new `MediaUnavailableError` (a `ProviderError` whose `reason` is `'not-durable'`, `'provider-mismatch'` or `'rehydrate-failed'`). `durability.inbox.mediaRefs: false` keeps the previous encoding. A provider without the hooks, and records written before this change, behave exactly as before. New exports: `MediaUnavailableError` and the `SerializedMediaRef` and `MediaUnavailableReason` types.
  
  The providers implement the hooks. Baileys journals only the media content (CDN url, direct path, media key and hashes; no thumbnail, caption or quoted context) plus the message key that re-upload requests need. It skips view-once media unless `durableMedia: { viewOnce: true }` is set, and it returns the cached original message while it is still in memory. Cloud API journals the media id and Telegram the `file_id`. None of them journals credentials, and each validates the stored value when it reads it back.
- efb1fa6: Native streaming of long/AI replies with `ctx.stream(source, opts)`. The strategy comes from the new `ProviderCapabilities.streaming` field (`'draft' | 'edit' | 'none'`): native drafts (Telegram `sendMessageDraft`, with `can_stop`/`keep_on_stop`), throttled message edits (Discord, Telegram groups) or sentence chunks with typing (WhatsApp). Updates are throttled, cancellation is supported (`signal`, the user's stop button) and no message exceeds `maxTextLength`. New exports: `streamText`, `resolveStreamStrategy`, `splitMessage`, `findSplitPoint` and their types; `IProvider.sendDraft`; `MockProvider({ streaming })`. `@bot-wa/ai` gains `AIClient.streamReplyInChat()` and the `stream` option for the autoresponder. The Telegram long-poll now also asks for `stopped_message_generation` updates. Live edits and drafts run the `before('send')` hooks (payload `stream: 'draft' | 'edit'`) and the message log keeps the final edited text; rate-limited edits back off for `retryAfterMs`; `onCancel: 'discard'` deletes the live message when the transport can. The streamed autoreply honours refusals (`refusalMessage`, not stored), replies `errorMessage` on an empty answer and, with `onCancel: 'discard'`, keeps a cancelled answer out of the context.
- 1cc2146: - Edited messages: `edited_message` keeps reaching the bot as a message with the new text and the original `ref.id` (replies, reactions and edits target the edited message); `ref.native.edit_date` is now set and the new `isEditedMessage(ctx)` helper tells an edit apart. New `editedMessages: 'deliver' | 'ignore'` option (default `'deliver'`): `'ignore'` stops requesting edits from `getUpdates` and drops them in webhook mode.
  - Self-hosted Bot API servers: `downloadMedia` failures now reject with typed errors that never include the URL (it carries the bot token): `PayloadTooLargeError` over `mediaDownload.maxBytes`, and a `ProviderError` naming `mediaDownload.allowHttp` / `allowPrivateHosts` when the download guard refuses a plain-HTTP or private host. A server started with `--local` (absolute `file_path`) gets an explanatory `ProviderError`. Documented in the README and the channels guide.

### Patch Changes

- 397c2be: Export types referenced by public signatures: `WAMediaUpload` and `DisconnectAction` (`@bot-wa/baileys`, whose `ChatId`/`UserId` are now core's), `GraphClientConfig` (`@bot-wa/meta`), and `TelegramMessageEntity`, `TelegramPhotoSize`, `TelegramLocation`, `TelegramContact`, `TelegramPoll` (`@bot-wa/telegram`).
- 99251ef: Declare `capabilities.exclusiveSession` (Baileys always, Telegram in long-polling mode), so with multi-replica coordination only the elected replica connects the session.
- 7b00477: `@bot-wa/core`: new optional `ProviderCapabilities.textFormat` (`TextFormat`: `'whatsapp' | 'markdown' | 'html' | 'plain'`), the rich-text dialect a channel renders, so Markdown producers (e.g. `@bot-wa/ai`) can convert their text. `MockProvider` accepts `textFormat`.
  
  `@bot-wa/baileys` and `@bot-wa/meta` declare `textFormat: 'whatsapp'`; `@bot-wa/telegram` declares `'plain'` (text is sent without `parse_mode`).
- ce7790f: Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
- 31f0fd2: Hardening: `callback_data` is cut to the Bot API's 64 **bytes** (UTF-8) without splitting a character, so buttons with accented or emoji ids no longer fail with `BUTTON_DATA_INVALID`. A `location` with `name` and `address` goes out as `sendVenue` instead of dropping them. `400 chat not found` / `user not found` / `bot is not a member` map to `RecipientUnreachableError`, and `413` / `file is too big` to `PayloadTooLargeError`. The long-poll loop stops with `sessionInvalid` when the token is revoked mid-run (it used to retry forever), and `stop()` → `start()` announces `ready` again.
- 31fcc2e: Inbound events never carry an empty id: callbacks on inline-mode messages use `inline_message_id` as `ref.id`, ephemeral messages (Bot API 10.2) use `eph:<ephemeral_message_id>`, and events without an addressable message get `upd:<update_id>` (stable across webhook retries). Edits, deletes and quotes resolve the right Bot API target from the ref; ephemeral messages are never quoted from a regular send.
- 4fc0560: Add native forms: `flow().form(definition, opts)` collects typed fields (text, number, email, date, select, multiselect, opt-in) with validation. Providers with the new `capabilities.forms: 'native'` receive an `OutboundContent` of kind `'form'` and reply with `'form'` inbound messages (`formReplyBody()` / `parseFormReply()`); every other provider gets field-by-field questions. `describe()` draws `form` nodes and `lint()` checks their timeouts and `c.state` key collisions. `@bot-wa/meta` renders forms as static WhatsApp Flows (`toFlowJson`, `toFlowMessage`, `publishForm()`, `config.flows`) and turns `nfm_reply` webhooks into form replies. Other providers reject the `form` kind with `UnsupportedContentError`. The new optional `IProvider.canRenderForm(form, { nativeId })` (exposed as `ctx.canRenderForm()`) lets a native provider say it has no native form for a definition; `CloudAPIProvider` implements it, so a form without a mapped Flow is asked field by field without first sending (and failing) a form message. Ambiguous grouped numbers (`1.500`, `1,500`) are rejected instead of being read as 1.5.
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
  - @bot-wa/http@0.2.0-alpha.0
