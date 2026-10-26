# @botmesh/baileys

## 1.0.0-beta.1

### Major Changes

- 79af076: First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).

### Minor Changes

- 511589e: API freeze of the WhatsApp (Baileys) transport before stable:
  
  - **Native values are opaque.** `BaileysProvider` implements `IProvider<BaileysNativeMessage>`; `provider.socket` is `BaileysSocket | null` and `provider.auth` is `BaileysAuthState`. The three new aliases are `unknown`, so no `@whiskeysockets/baileys` type reaches the main entry's declarations (`pnpm api-check` now fails if one does). Runtime values are unchanged. **Breaking (types):** code that used the socket's methods through `provider.socket` needs `socketOf(provider)` from `@botmesh/baileys/internal`, or a cast.
  - **New `@botmesh/baileys/internal` entry (no semver):** the JID helpers, `IdentityStore`, `canonicalKey`, the mappers (`toInbound`, `toOutbound`, `toCallEvent`, `mapSendError`), media processing, ffmpeg resolution, reconnect classification, the session-path helpers, the Baileys logger adapter, and the typed handles `socketOf(provider)` / `authStateOf(provider)`. The main entry keeps `BaileysProvider` and its option types, `toJid`, `isEditedMessage`, `RateLimiter`/`RateLimiterTimeout` and the `PollStore` types; the other names stay as `@deprecated` aliases until v3. **Breaking:** `toInbound` and `toOutbound` are no longer exported by the main entry (their signatures use Baileys' types).
  - **`pairingPhoneNumber`** replaces `pairingCode` (deprecated alias; the value was always the bot's phone number). Both set to different numbers throws a `TypeError`.
  - **`debug` is deprecated** in favour of `logger` (any `LoggerLike`).
  - The JID predicates (`isGroup`, `isPn`, `isLid`, `isBroadcast`, `isNewsletter`) return `boolean` instead of `boolean | undefined`.
  - When `ffmpeg-static` is installed without its binary (its build script was skipped), the voice-note error now says to allow that download instead of suggesting to add `ffmpeg-static` again.
  - README: the TypeScript note now says that only `@botmesh/baileys/internal` needs `skipLibCheck: true` (the main entry type-checks without it); the entries, opaque native types and the upstream upgrade policy (Baileys stays pinned to `7.0.0-rc14`: no stable 7.x exists on npm).
- 2c17b23: Fixes for the low-severity defects left open by the alpha exit review:
  
  - **Behaviour change:** a text edit is now delivered as a message with the new text and the ORIGINAL `ref.id` (like `@botmesh/telegram`), instead of being dropped. `isEditedMessage(ctx)` tells it apart, and the new `editedMessages: 'ignore'` option restores the old behaviour. The core dedupe lets an edit through (new content, same id) and drops an identical retry. Only an edit of a message this process has seen, sent in the same chat by the user who sends the edit, is delivered: an edit naming another participant's message, one of the bot's own, a message from another chat or an original no longer in the message cache (for example after a restart) is dropped.
  - **Breaking:** `toJid()` throws a `TypeError` for input without digits (it returned `'@s.whatsapp.net'`) and for `{ groupId, userId }` (it returned an invalid `…@g.us:<user>` string; a group participant has no JID of its own: use `toJid({ groupId })` for the chat and `toJid(userId)` for the person). An old-style group id keeps its hyphen (`<creator>-<timestamp>@g.us`).
  - `reconnect` also takes a policy object, `{ maxAttempts, baseMs, capMs }` (defaults 10, 1000, 30000), validated at construction; the `ReconnectPolicy` type is exported.
  - `RateLimiter.reset()` (run by `stop()`) cancels the limiter's pending sleeps, so a long jitter no longer keeps the process alive, and a send that was sleeping in its jitter is rejected instead of going out after the reset.
  
  What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
- ac11ddf: `timestamp` is epoch milliseconds on every channel.
  
  **Breaking:** `InboundMessage.timestamp`, `InboundInteraction.timestamp`, `DeliveryStatus.timestamp` and `ctx.timestamp` are epoch **milliseconds** everywhere. `@botmesh/baileys`, `@botmesh/meta` and `MockProvider` (`@botmesh/core/testing`) used to emit epoch seconds; drop any `* 1000` in your code (`new Date(ctx.timestamp)` is now right).
  
  - A missing or invalid transport time is the receive time (`Date.now()`), never `0` (Baileys and the Cloud API emitted `0`).
  - `@botmesh/telegram`: a callback query (button press) carries the receive time; the Bot API sends no press time and the date of the message holding the keyboard could be days old.
  - `@botmesh/core` still converts a value below `1e12` from a third-party provider that emits seconds, for `ctx.timestamp` and the message log (soft path), and the message log keeps the receive time for a second-precision stamp of the current second whether it arrives in seconds or ms.
  - New contract helpers in `@botmesh/core/testing`: `checkInboundContract` / `assertInboundContract` (and `InboundContractError`) check epoch-ms timestamps, `respondBy`, `body`, `mentions` and the message type of a provider's events.
- 50fb2b6: **Breaking (behaviour):** one policy for presence hints while the transport is disconnected. `ctx.typing()`, `ctx.recording()`, `ctx.markRead()` and the automatic typing indicator are best-effort: while the provider's last connection state is not `'ready'`, or once the bot is stopped, the bot does not call the provider; the hint resolves, is logged at debug and counted in the new `metrics().presenceSkipped` (`{ typing, markRead }`, `botmesh_presence_skipped_total{kind}` in `toPrometheus()`). The rule is part of the `IProvider` contract ("PRESENCE WHILE DISCONNECTED"); Baileys, the Cloud API and Telegram (and the other built-in channels) follow it when called directly too: `markRead()` / `typing()` resolve without contacting the transport while not connected. New `checkPresenceWhileDisconnected` / `assertPresenceWhileDisconnected` in `@botmesh/core/testing`.
- 3c217b5: **Breaking: ffmpeg is no longer bundled.** Voice notes are transcoded by running an ffmpeg binary directly instead of through `fluent-ffmpeg` (deprecated upstream) and `@ffmpeg-installer/ffmpeg` (unmaintained, an old ffmpeg). The binary is `FFMPEG_PATH` when set, else the binary of the new optional peer dependency `ffmpeg-static` when it is installed and downloaded, else `ffmpeg` on the `PATH`. Without one, a voice note rejects with an `UnsupportedContentError` that explains how to install ffmpeg; every other send is unaffected. Migration: install ffmpeg in the image of a bot that sends voice notes (`apt install ffmpeg`), or add `ffmpeg-static`. See the migration guide.
  
  - Dependencies: `sharp` `^0.35.5` (security fix), and the unused `follow-redirects` and `mime-types` are removed.
  - Baileys stays on `@whiskeysockets/baileys@7.0.0-rc14`: it is still the newest release upstream (no stable 7.x exists; 6.x is the legacy line without LID addressing). The README explains the pin.

### Patch Changes

- 43e6cfa: Release-readiness fixes found by an end-to-end review of the WhatsApp (Baileys) transport:
  
  - **Protocol stanzas are no longer delivered as messages.** Baileys upserts every stanza before processing it, so reactions, deletes and edits (`protocolMessage`), sender-key distributions and placeholders for messages that failed to decrypt reached the bot as `type: 'unknown'` messages: a catch-all handler answered every reaction, and an active `ask` took a reaction as its answer. They are now skipped (reactions still arrive as the `reaction` event). Reactions in statuses, broadcast lists and channels follow the same `ignoreBroadcasts`/`ignoreNewsletters` filter as messages.
  - **One malformed event no longer drops the rest of its batch.** Each Baileys event kind, and each upserted message, is handled in isolation; a failure is logged (`err` only, never a body) and the other events still arrive. Emitted message ids and bodies are always strings.
  - **`start()`/`stop()` races:** a `stop()` while `start()` is still loading the auth state or the WhatsApp Web version no longer leaves a live socket behind, and a second `start()` ends the previous socket instead of opening two on one session (WhatsApp would close one with 440). The late close of a socket ended by `stop()` or `logoutAndDeleteSession()` (Baileys ends it asynchronously) is ignored, so it can no longer schedule a reconnect over the next `start()` or, after a logout, wipe the new session with its 401.
  - **A rejecting or throwing `qr.handler` is logged** instead of crashing the process with an unhandled rejection.
  - **`reconnect exhausted`** is now emitted (as a final `closed` event) when transient drops use up the reconnect attempts, not only when `start()` keeps failing.
  - **Voice notes and stickers accept URLs and streams**, as the guides show (`ctx.voice(url)`, `ctx.sticker(url, …)`): URLs are downloaded through the same SSRF-safe fetcher as other media and streams are capped at `remoteMedia.maxBytes`. Before, they failed with "Remote URL not supported here".
  - **Sticker `pack`/`author` are written** into the WebP's EXIF metadata WhatsApp reads; they were silently ignored.
  - **`sharp` and `ffmpeg` load lazily**, on the first sticker or voice note: a platform where one of them cannot load still imports the package and sends text, and the media send fails with an actionable `UnsupportedContentError`.
  - **Clear errors for content WhatsApp cannot carry:** polls need a question and 2–12 unique, non-empty options (duplicate names made votes indistinguishable); a missing local media file or an unsupported media source rejects with `UnsupportedContentError` instead of an opaque `ENOENT`. Voice/sticker conversion failures are `UnsupportedContentError` too.
  - **Reactions to a ref without its native message** (e.g. read back from a store) rebuild the target key instead of failing with a `TypeError`.
  - **Contact cards escape the display name**, so it cannot inject vCard fields.
  - **Poll votes keep only the poll's own option hashes**, so a crafted vote cannot bloat the tally or the `pollStore` entry.
  - **`deleteMessage()` rejects with typed `ProviderError` subclasses** like `send()`.
  - **Config mistakes fail in the constructor:** a non-empty `pairingCode` without a usable phone number (6–15 digits) and an unknown `browser` preset or malformed tuple throw a `TypeError` with the accepted values. Before, the first fell back to the QR after a warning and the second was silently ignored. An empty or blank `pairingCode` (e.g. an empty `WA_PAIRING_NUMBER=` env var) still means QR mode.
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
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

- 0a2291f: `BaileysProviderConfig.logger` takes any core `LoggerLike` (pino, `console` or a `{ debug, info, warn, error }` object), not only pino's `Logger`. Baileys' own functions receive a `BaileysLogger` through the new `toBaileysLogger()`: a pino-shaped logger passes through untouched; anything else is wrapped (`trace` forwarded when present, else a no-op; `level` falls back to `'info'`; `child()` wraps `logger.child()` when available). Also exported: `isBaileysLogger()` and the `BaileysLogger` type.
- 31fcc2e: - New `pollStore` option (`PollStore` / `StoredPoll` types): persist polls so their votes can still be decrypted after a restart. The in-memory cache of 500 polls stays in front of it; a failing store is logged and never breaks a send or receive. The stored entry holds the poll secret, so treat it like the session folder.
  - `ctx.quoted.senderId` is canonical (LID → PN when known), like mentions, so `ctx.quoted?.senderId === provider.selfId` detects a reply to a bot message.
  - Messages of ignored chats (status, broadcast lists, newsletters) no longer take room in the 2000-message resend cache.
- 522bcca: - Pin `@whiskeysockets/baileys` to `7.0.0-rc14`.
  - Decrypt poll votes and emit the `poll` event with the aggregated tally; votes are bound to their poll's chat and creator and counted once.
  - Canonical (LID → PN) ids on reactions, poll votes, group, call and presence events, inbound mentions and `selfId`; calls go through the same identity canonicalisation as messages and group calls carry `chatId`/`isGroup`.
  - Leave the `browser` identity unset by default (Baileys' own macOS/Chrome), warn on custom tuples.
  - Fix: reactions report the reactor, not the message author; device-qualified PNs from `getPNForLID` are normalised; errors log under pino's `err` key; `RateLimiterTimeout` maps to `RateLimitedError`; sent messages answer resend requests.
- 147163f: Security: outbound `{ url }` / `https://…` media is now downloaded by the provider through `@bot-wa/http` (every redirect hop vetted, private and link-local hosts refused, socket pinned to the vetted address, 64 MiB and 60 s caps) and sent to Baileys as a Buffer. Baileys' own `fetch` followed redirects blindly, so a public URL redirecting to an internal address was an SSRF. New `remoteMedia` option (`maxBytes`, `timeoutMs`, `allowHttp`, `maxRedirects`, `resolver`, `fetch`); `remoteMedia.allowPrivateHosts: true` restores the previous pass-through. An unsafe or failing URL rejects with `UnsupportedContentError`, an oversized one with `PayloadTooLargeError`.
- 9b97391: Inbound locations fill the normalized `InboundMessage.location` (`ctx.sharedLocation`): Baileys `locationMessage` and `liveLocationMessage` (`live: true`; a live location's body is now its caption), Cloud API `location`, Telegram `location` (live when `live_period` is set) and `venue` (its title becomes the body; new `TelegramVenue` type).
- f25b2af: Durable media references, so a replayed inbound message can still download its media. `IProvider` gains two optional hooks: `serializeMediaRef(ref)` returns a JSON-safe, versioned `{ v, data }` (or `undefined`), and `rehydrateMediaRef(stored, ref)` rebuilds the `MediaRef`. With `BotConfig.durability` on, the inbox journals that reference instead of the live media token. A replay (crash recovery, background retry, operator `replayInbound`) rebuilds it inside the chat's turn, so per-chat order is kept. When the media cannot be rebuilt, the message still runs and only its download fails: `loadMediaOf(ctx, { throwOnError: true })` rejects with the new `MediaUnavailableError` (a `ProviderError` whose `reason` is `'not-durable'`, `'provider-mismatch'` or `'rehydrate-failed'`). `durability.inbox.mediaRefs: false` keeps the previous encoding. A provider without the hooks, and records written before this change, behave exactly as before. New exports: `MediaUnavailableError` and the `SerializedMediaRef` and `MediaUnavailableReason` types.
  
  The providers implement the hooks. Baileys journals only the media content (CDN url, direct path, media key and hashes; no thumbnail, caption or quoted context) plus the message key that re-upload requests need. It skips view-once media unless `durableMedia: { viewOnce: true }` is set, and it returns the cached original message while it is still in memory. Cloud API journals the media id and Telegram the `file_id`. None of them journals credentials, and each validates the stored value when it reads it back.

### Patch Changes

- 397c2be: Export types referenced by public signatures: `WAMediaUpload` and `DisconnectAction` (`@bot-wa/baileys`, whose `ChatId`/`UserId` are now core's), `GraphClientConfig` (`@bot-wa/meta`), and `TelegramMessageEntity`, `TelegramPhotoSize`, `TelegramLocation`, `TelegramContact`, `TelegramPoll` (`@bot-wa/telegram`).
- 7e09c69: - Wrapped messages (disappearing mode, view once, document with caption) are unwrapped before classification, so they arrive with their real `type`, `body` and `media` instead of `'unknown'`.
  - Reply context and mentions are read from image, video and document captions too, not only from text messages; `quoted.ref` now points at the quoted message (a WAMessage-shaped `native`, usable as `quoted` to reply in thread), and a quoted media caption fills `quoted.body`.
  - `timestamp` is always a plain number (protobuf `Long` timestamps were passed through as objects); location and contact messages get a readable `body`; template button replies map to `type: 'buttons'`.
  - `stop()` cancels a pending reconnect, so a later `start()` no longer races a stale backoff timer into a second socket.
  - `downloadMedia()` rejects with a `ProviderError` when disconnected or when the download fails (was a `TypeError` / raw Baileys error); `markRead()` and `deleteMessage()` accept refs without a native key (rebuilt from `chatId` + `id`), and `deleteMessage()` rejects when disconnected instead of silently doing nothing.
- 99251ef: Declare `capabilities.exclusiveSession` (Baileys always, Telegram in long-polling mode), so with multi-replica coordination only the elected replica connects the session.
- 7b00477: `@bot-wa/core`: new optional `ProviderCapabilities.textFormat` (`TextFormat`: `'whatsapp' | 'markdown' | 'html' | 'plain'`), the rich-text dialect a channel renders, so Markdown producers (e.g. `@bot-wa/ai`) can convert their text. `MockProvider` accepts `textFormat`.
  
  `@bot-wa/baileys` and `@bot-wa/meta` declare `textFormat: 'whatsapp'`; `@bot-wa/telegram` declares `'plain'` (text is sent without `parse_mode`).
- 4d95812: `create-bot-wa` stamps `@bot-wa/*` dependency ranges derived at build time from each public package's current version (`^<exact version>`, e.g. `^2.0.0-alpha.2` or `^0.1.1-alpha.0`), instead of hand-written constants like `^0.1.0` that npm does not resolve to a prerelease — freshly scaffolded projects install while the packages are on the `alpha` line. The `@bot-wa/baileys` README links its example on GitHub (the relative link broke on npmjs.com).
- ce7790f: Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
- efb1fa6: Native streaming of long/AI replies with `ctx.stream(source, opts)`. The strategy comes from the new `ProviderCapabilities.streaming` field (`'draft' | 'edit' | 'none'`): native drafts (Telegram `sendMessageDraft`, with `can_stop`/`keep_on_stop`), throttled message edits (Discord, Telegram groups) or sentence chunks with typing (WhatsApp). Updates are throttled, cancellation is supported (`signal`, the user's stop button) and no message exceeds `maxTextLength`. New exports: `streamText`, `resolveStreamStrategy`, `splitMessage`, `findSplitPoint` and their types; `IProvider.sendDraft`; `MockProvider({ streaming })`. `@bot-wa/ai` gains `AIClient.streamReplyInChat()` and the `stream` option for the autoresponder. The Telegram long-poll now also asks for `stopped_message_generation` updates. Live edits and drafts run the `before('send')` hooks (payload `stream: 'draft' | 'edit'`) and the message log keeps the final edited text; rate-limited edits back off for `retryAfterMs`; `onCancel: 'discard'` deletes the live message when the transport can. The streamed autoreply honours refusals (`refusalMessage`, not stored), replies `errorMessage` on an empty answer and, with `onCancel: 'discard'`, keeps a cancelled answer out of the context.
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
