# Release readiness: stable

Go/no-go report for moving the public `@botmesh/*` packages to a **stable** release
(core `2.0.0`, the others at a version the maintainer picks). It covers thirteen packages:
the ten public since the alpha and `@botmesh/postgres-store`, `@botmesh/mysql-store` and
`@botmesh/mongo-store`, made public in the [store promotion round](#store-promotion-round). It closes the
stable-readiness campaign of October 2026: six workstreams, each tested by one agent and
checked by a reviewer, merged into `main` and verified together. The previous report
(the alpha → beta campaign, base `9bcba20`) gave **GO for beta** and **NO-GO for stable**
because the API freeze was still open; this campaign took those API decisions.

Date: 2026-10-26. Base: `e148ea2`. Result: six `merge: stable readiness <key>` commits,
six `fix: integrate <key>` commits, one docs commit tying the migration guides together
(see [Integration](#integration)), and this report. A closeout round then merged three
more branches on top of `2726645` (`co/core`, `co/channels`, `co/sandbox`; see
[Closeout round](#closeout-round)). A final **API freeze round** then merged four more
branches on top of `4487b43` (`af/ai`, `af/baileys`, `af/meta-net`, `af/redis`; see
[API freeze round](#api-freeze-round)); the verdicts and numbers below are from after it,
except the three promoted stores, whose figures are in the
[store promotion round](#store-promotion-round). Nothing was published or pushed.

## Verdict

| Step | Decision | Why |
| --- | --- | --- |
| **alpha → beta** | **GO** | Still GO. Every check below is green on the merged `main`, including all real-server suites, the Docker sandbox suites and a full build and test run on Node 22. |
| **beta → stable, `@botmesh/core`** | **GO after one beta** | The API freeze is done for core: the main entry went from 512 to 372 names, engine internals moved to `/internal`, a semver-covered `/spi` exists for backend authors, every concept has one canonical name (the others are `@deprecated`), and the behaviour decisions (English default, `retries`/`maxAttempts`, sends need a running bot, long-text splitting, epoch-ms timestamps, presence while disconnected, the `'stopping'` event) are taken, tested and documented with migration pages. No core item from the previous report is left open; what remains is a beta used by a real bot (see [core](#core)). |
| **beta → stable, the other nine public packages of the alpha** | **GO after one beta** | The API freeze is done for every public package. Each one has a semver-covered main entry, and the packages that had engine helpers on it now have an `/internal` entry with no semver (`ai`, `baileys`, `redis-store`, `create-botmesh`) and, for `ai`, a `/testing` entry. Mutable exports are frozen, the option names are settled and the old names are `@deprecated` aliases. Each break has a migration note. No package has an open HIGH or MEDIUM item. |
| **beta → stable, `postgres-store`, `mysql-store`, `mongo-store`** | **GO after one beta** | Promoted from private in the [store promotion round](#store-promotion-round) and frozen like `sqlite-store`/`redis-store`: drivers are lazy-loaded peers, no driver type reachable from a `.d.ts` (`api-check`), `logger: Partial<LoggerLike>`, store and schedule conformance suites plus the real-server suites. They first ship in this beta (`1.0.0-beta.0`), so their beta period starts now; no open HIGH or MEDIUM item. |
| **Still blocking, exactly** | **Nothing but the beta** | Decided 2026-10-26: `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's own npm `latest` tag (the only stable line, `6.7.x` `legacy`, lacks LID addressing). The pin and the upgrade policy are in its README. The stable line is `@botmesh/core` 2.0.0 and **1.0.0 for the other nine public packages** (changeset `first-stable-1-0.md`; with minor bumps they would have stayed on 0.2.0, which semver does not treat as stable). Nothing else blocks `pre exit` except the beta itself (see [Before stable](#before-stable-pre-exit)). |

Per package:

| Package | Stable verdict | Blocking before `pre exit` |
| --- | --- | --- |
| `@botmesh/core` | GO after one beta | None. Every core item of the previous report is closed (see [core](#core)). |
| `@botmesh/ai` | GO after one beta | None. Helpers and wire type names in `/internal`, `MockAIProvider` and `validateArgs` in `/testing` (deprecated main alias for the mock), exported data frozen, `onStreamEnd` contract fixed and enforced on abort, provider constructors take `AIProviderConfig`, Azure heuristic widened (main entry 135 → 97). Not blocking: confirm the Kimi default model during beta (default models are outside semver). |
| `@botmesh/baileys` | GO after one beta (rc pin accepted 2026-10-26) | Done: native values typed as opaque `unknown` aliases (no Baileys type in the main entry's `.d.ts`, enforced by `api-check`), JID helpers, identity store and mappers in `/internal` (deprecated aliases on main, `toInbound`/`toOutbound` only in `/internal`), `pairingPhoneNumber` (alias `pairingCode`), `debug` deprecated, ffmpeg-static hint loop fixed. Left: upstream is still `7.0.0-rc14` (no stable 7.x on npm as of 2026-10-26); the pin and upgrade policy are documented in the README. Decision: ship stable on that pin; a later upstream release is a deliberate patch/minor after the full identity suite and a real login. |
| `@botmesh/meta` | GO after one beta | None. `GraphClient`, `toProviderError`, the verify re-exports and `debug` are `@deprecated`; `phoneNumberId` is `string \| number`; `lang` for Flow labels. Session window decided: the configuration and query surface (`SessionWindowManager`, `SessionWindowOptions`, `SessionWindowStore`, `MemorySessionWindowStore`, report types) is public with semver; the provider plumbing (`send`, `noteInbound`, `noteFailedStatus`, `RawSend`) is `@experimental`. |
| `@botmesh/telegram` | GO after one beta | None. `pollTimeoutMs` (alias `pollTimeout`), `toTelegramError`, `@experimental` wire helpers, `debug` deprecated, poll votes parsed. |
| `@botmesh/sqlite-store` | GO after one beta | None. Schema migrations via `PRAGMA user_version`, newer files refused untouched (`SQLiteSchemaVersionError`), DDL exports deprecated, `logger: Partial<LoggerLike>`, `busyTimeoutMs`. The schedules and durable tables are part of the schema since version 2 (a v2 file is refused by the previous alpha; rollback documented). |
| `@botmesh/redis-store` | GO after one beta | None. The cluster layout internals moved to `@botmesh/redis-store/internal` (deprecated re-exports kept on the main entry); the deprecated `ttl` option and `acquireLock` were removed. Real single-node and Cluster suites (chaos on) pass with node-redis 4, 5 and 6. |
| `@botmesh/postgres-store` | GO after one beta (first public in this beta) | None. `pg` is a lazy-loaded peer (only when the store or `PostgresDurability` builds its own pool, with an install hint); `NativePostgresPool` is structural, so `@types/pg` is no longer a dependency; `logger: Partial<LoggerLike>`. Main entry 11 names, no `/internal`. |
| `@botmesh/mysql-store` | GO after one beta (first public in this beta) | None. `mysql2` is a lazy-loaded peer; `PoolLike`/`ConnectionLike` renamed `MysqlPoolLike`/`MysqlConnectionLike` (hard rename: the package was private); a statement picked as deadlock victim is retried (up to 5 times; MariaDB gap locks on concurrent save + trim). Main entry 9 names. |
| `@botmesh/mongo-store` | GO after one beta (first public in this beta) | None. `mongodb` 6.x and 7.x accepted as a lazy-loaded peer; `deleteChat` falls back to two deletes on a standalone 7.x server; `ScheduleDoc` renamed `MongoScheduleDoc`, `MongoLikeSession` exported; a store that builds its own client rejects calls before `start()`. Main entry 12 names. |
| `@botmesh/http`, `@botmesh/graph-core` | GO after one beta | None. `SecureFetchOptions` no longer extends `RequestInit` (no `redirect`; other `RequestInit` fields through a deprecated overload until stable); `resolveHost` (alias `resolvePublicHost`); `checkGraphSignature({ ... })` (positional form deprecated); graph-core is covered by semver. |
| `create-botmesh` | GO after one beta | None. `TEMPLATES`, `agentsMd` and `findBotMeshMonorepo` live in `create-botmesh/internal` (no semver), deprecated on the main entry. |

## What changed

### API decisions taken (core)

- **Package entries.** `@botmesh/core` keeps only what an application needs (372 names,
  30 of them `@deprecated` aliases). Engine classes and helpers (`Dispatcher`,
  `ConversationRuntime`, `HookSystem`, `Scheduler`, `InboundDeduper`, `checkAccess`,
  `cronNextRun`, `findSplitPoint`…) are in `@botmesh/core/internal` (no semver, 79
  names). The backend and transport SPI (`KvDurability`, `MemoryKv`, journal and schedule
  record types, `MemoryScheduleStore`, `MemoryLeaseProvider`, `messageKey`,
  `toInboundLocation`, `I18n`, the W3C traceparent helpers…) is the new semver-covered
  `@botmesh/core/spi` (93 names). `MemoryCoordinator`/`MemoryCoordinationHub` moved to
  `/testing`. The deprecated main-entry re-exports of internals were removed.
- **One name per concept**, the rest `@deprecated` with the replacement in their TSDoc:
  `ctx.reply`, `flow`, `bot.send`, `bot.plug` (plugins) / `bot.use` (flows),
  `bot.trigger`, `onType`/`when(IMAGE)`, `BotConfig`, `AccessList`,
  `durability.backend` (was `journal`), `BotConfig.store` (was `storeConfig`),
  `ConversationHandler`, broadcast `retries` (was `maxRetries`).
- **Configuration.** Every `BotConfig` duration option, including every `*Ms` option,
  takes a duration string; `new Bot()` validates all 21 duration paths and throws
  `ConfigValidationError` naming the option. A plugin name can be plugged once unless
  every instance sets `PluginSpec.multiple`.
- **Behaviour.** Built-in texts default to English (`BotConfig.lang: 'es'` keeps
  Spanish). `retries` always means attempts after the first; the new `maxAttempts` is
  the total (default budget unchanged), with a one-time warning for legacy `retries`
  and flow-schema documents migrated to v2. Sends, edits and stream updates before
  `start()` or after `stop()` reject with `BotNotRunningError`. `choose()` and state
  keys are validated when the flow is defined. Malformed provider events become
  `InvalidProviderEventError`. A before-hook calling `next()` twice keeps the first
  dispatch. Log lines hash chat and sender ids by default (`logIds`). A corrupt middle
  line in an append log is refused (`APPEND_LOG_CORRUPT`). `MemoryCoordinationHub`
  evicts idle chats. Rate-limited `ctx` sends retry once (`rateLimitRetry`).
- **Channel contract.** Timestamps are epoch milliseconds on all 13 channels. Text over
  `maxTextLength`/`maxTextBytes` is split by the core (graphemes, links and markup kept
  whole; hooks run once; durable parts journaled in order). An unsupported operation is
  an absent method plus a `false` capability flag. Too many options reject with
  `UnsupportedContentError`. Interactions on transports that require an ack are
  acknowledged by the core exactly once. Contract checks
  (`assertInboundContract`, `assertCapabilityContract`) run against every provider.

### API decisions taken (API freeze round)

The same pattern as core's `/internal` and `/testing`: a subpath in `package.json`
`exports`, covered by `pnpm api-check` (semver rules skip `/internal`) and imported from
the tarball by `pnpm pack:smoke`; a `@deprecated` re-export on the main entry wherever users
may already import the name; an entry-pin test listing each entry's runtime names.

- **`@botmesh/ai`.** Main entry 135 → 97 names (3 of them `@deprecated`). New
  `@botmesh/ai/testing` (semver, 5 names: `MockAIProvider`, `MockOptions`, `MockTurn`,
  `validateArgs`, `ArgsValidation`) and `@botmesh/ai/internal` (no semver, 39 names: 22
  plugin helpers, 16 SDK wire type names, `openAIMaxTokensField`). The client contracts
  (`AnthropicLike`, `OpenAILike`, `GeminiLike`, `GeminiModelLike`, `GoogleGenAILike`) stay
  on the main entry with the same shape. `PRESETS`, `DEFAULT_YES`, `DEFAULT_NO`,
  `AI_MESSAGES` and `AI_LOCALES` are deep-frozen; `toolConfirm.yes`/`.no` accept
  `readonly string[]`, so the defaults can be passed unchanged. `onStreamEnd` receives
  `AIStreamEndInfo`, runs once after the last chunk and only on a normal end (never on an
  error, an abort or an early `break`). Provider constructors take `AIProviderConfig`.
  Azure: `max_completion_tokens` also for `*.cognitiveservices.azure.com` and Foundry
  `*.services.ai.azure.com/openai`.
- **`@botmesh/baileys`.** Main entry 55 → 56 names, 22 of them not deprecated: the rest
  are `@deprecated` aliases of the new `@botmesh/baileys/internal` (no semver, 58 names:
  JID helpers, `IdentityStore`, mappers, media, reconnect and session helpers,
  `socketOf`/`authStateOf`). Native values are opaque (`BaileysNativeMessage`,
  `BaileysSocket`, `BaileysAuthState`, all `unknown`); no `.d.ts` reachable from the main
  entry imports `@whiskeysockets/baileys`, and `api-check` now fails if one does
  (`SEMVER_FORBIDDEN_IMPORTS`). `toInbound`/`toOutbound` are only in `/internal` (the one
  hard break). `pairingPhoneNumber` replaces `pairingCode` (alias), `debug` is deprecated,
  JID predicates return `boolean`.
- **`@botmesh/http`.** `SecureFetchOptions` is a closed set (no `redirect`; other
  `RequestInit` fields through the `@deprecated` `LegacySecureFetchOptions` overload until
  stable); stream bodies get `duplex: 'half'` automatically; `resolveHost` (alias
  `resolvePublicHost`). Main entry 12 → 14 names (4 deprecated).
- **`@botmesh/graph-core`.** `checkGraphSignature({ body, headers, appSecret, logger })`;
  the positional form is a `@deprecated` overload. graph-core is covered by semver. 22 → 24
  names.
- **`@botmesh/meta`.** The session-window configuration and query surface is semver;
  `send`, `noteInbound`, `noteFailedStatus` and `RawSend` are `@experimental`. 67 names,
  unchanged.
- **`@botmesh/redis-store`.** New `@botmesh/redis-store/internal` (no semver, 17 names:
  key builders, hash-slot and layout helpers). The main entry keeps 34 names, 5 of them
  `@deprecated` re-exports (`INDEX_BUCKETS`, `LAYOUT_MARKER`, `bucketOf`, `encodeSegment`,
  `hashSlot`). The deprecated `ttl` option and `acquireLock()` were removed (a JavaScript
  call throws a `TypeError` naming `sessionTtl` / `acquireLockFenced`).
- **`@botmesh/sqlite-store`.** Schema version 2 creates the schedules, schedule fences and
  durable tables in the migrations. The previous alpha refuses a v2 file; the rollback path
  is documented.
- **`create-botmesh`.** New `create-botmesh/internal` (no semver: `TEMPLATES`, `agentsMd`,
  `AgentsMdInfo`, `findBotMeshMonorepo`), re-exported `@deprecated` by the main entry
  (13 names, 9 not deprecated). `create-botmesh` is now in `api-check`.

Export counts from `node scripts/api-check.cjs surface`, before (`4487b43`) and after:

| Package | Main entry before | Main entry after (deprecated) | New entries |
| --- | --- | --- | --- |
| `@botmesh/core` | 372 | 372 (30) | none (`/internal` 79, `/spi` 93, `/testing` 118, `/testing/vitest` 6, `/dev` 52, all unchanged) |
| `@botmesh/ai` | 135 | 97 (3) | `/testing` 5, `/internal` 39 |
| `@botmesh/baileys` | 55 | 56 (34) | `/internal` 58 |
| `@botmesh/meta` | 67 | 67 (5) | none |
| `@botmesh/telegram` | 27 | 27 (1) | none |
| `@botmesh/sqlite-store` | 10 | 10 (2) | none |
| `@botmesh/redis-store` | 34 | 34 (5) | `/internal` 17 |
| `@botmesh/http` | 12 | 14 (4) | none |
| `@botmesh/graph-core` | 22 | 24 (1) | none |
| `create-botmesh` | 13 | 13 (4) | `/internal` 4 |

### Breaking changes and where they are documented

Each breaking change has a changeset, a Spanish entry under `[Unreleased]` in
`CHANGELOG.md`, and a section in the EN/ES migration guides. The four guides form one
set in both sidebars:

| Guide (EN / ES) | Covers |
| --- | --- |
| [Migrating to stable: API surface](guide/stable-migration.md) / [Migrar a estable: API](es/guide/migracion-estable.md) | Entry layout (`/internal`, `/spi`, `/testing`), every moved name, canonical names, `storeConfig`, plugin uniqueness, durations, logger convention. |
| [Migrating to stable: behaviour](guide/migration-2.md) / [Migrar a estable: comportamiento](es/guide/migracion-2.md) | English default, `retries` vs `maxAttempts`, `BotNotRunningError`, flow definition errors, `logIds`, append-log corruption, hub eviction, meta Flow labels in English. |
| [Migrating to stable: dependencies](guide/migration.md) / [Migrar a estable: dependencias](es/guide/migracion.md) | Baileys ffmpeg, Graph `v26.0`, `redis` peer `^4.7 \|\| ^5 \|\| ^6`, `@google/genai` and the new default models, `botwa` → `botmesh` renames (and the names that stay). |
| [Upgrade notes: channels & plugins](guide/upgrade-channels-plugins.md) / [Notas de actualización: canales y plugins](es/guide/actualizar-canales-plugins.md) | Per-channel and plugin fixes (Baileys edits and `toJid`, meta limits, Telegram webhook after `stop()`, sqlite surrogates, Discord bare `interactionId`…). The cross-channel contract is in [Channels](guide/channels.md) / [Canales](es/guide/canales.md). |

Breaking changes in public packages, by package:

- **core**: entry layout and removed re-exports; `MemoryCoordinator*` to `/testing`;
  plugin uniqueness; duration validation; English default; `retries` meaning;
  `BotNotRunningError`; flow definition errors; hashed log ids; `APPEND_LOG_CORRUPT`;
  hub eviction; epoch-ms `ctx.timestamp`; long text split (`splitLongText: false`
  restores the old rejection); `toPrometheus()` names `botmesh_*`
  (`{ prefix: 'botwa_' }` keeps the old ones).
- **ai**: English built-in texts without a chat context; Gemini prefers
  `@google/genai`; new default models (outside semver); `max_tokens` for non-OpenAI
  `baseUrl`s; memory options validated in `aiPlugin()`.
- **baileys**: epoch-ms timestamps; ffmpeg no longer bundled; text edits delivered as
  messages (`editedMessages: 'ignore'` restores); strict `toJid`.
- **meta**: Graph `v26.0` default; `played` reported as `read`; no-op `typing()` and
  `deleteMessage()` removed; interactive limits checked locally; unknown interactive
  replies arrive as `unknown`; Flow labels default to English.
- **telegram**: epoch-ms button timestamps; no-op `markRead()` removed; webhook
  `ingest()` after `stop()` answers 503.
- **sqlite-store**: lone surrogates rejected in ids and cursors.
- **redis-store**: `redis` is a peer; `NativeRedisClient*` are structural interfaces.
- **graph-core**: HTTP 413 maps to `PayloadTooLargeError` (a subclass of the old error).
- **create-botmesh**: generated Spanish bots set `lang: 'es'`.

Added by the API freeze round (each in the "Channel and store packages", "`@botmesh/ai`
entries" and "HTTP, Graph and scaffolder packages" sections of the stable migration guides,
EN and ES):

- **ai**: helpers and SDK wire type names only in `/internal`; `validateArgs` only in
  `/testing`; frozen exported data; `AIProviderConfig` rejects object literals with plugin
  fields (`TS2353`); `onStreamEnd` skipped on abort.
- **baileys**: `toInbound`/`toOutbound` only in `/internal`; opaque native types
  (`socket`, `auth`, `raw`/`native`); JID predicates return `boolean`.
- **http**: `redirect` and browser-only fields no longer in `SecureFetchOptions` (types only).
- **redis-store**: `ttl` and `acquireLock()` removed.
- **sqlite-store**: schema version 2 (a v2 file cannot be opened by the previous alpha).

Deprecated aliases kept for a soft path (removal planned for v3): `ctx.say/answer/text`,
`addKeyword`, `bot.sendText/sendTo`, `bot.use(plugin)`, `bot.useFlow`,
`bot.triggerFlow`, `bot.enterConversation(name, ctx)`, `onImage`…`onPoll`, `Config`,
`Whitelist`, `ConversationFn`, `durability.journal`, `storeConfig`, broadcast
`maxRetries`, the transcript helpers on the main entry, Discord `autoAckMs`, the
eslint-plugin `BotWa*` types and the `botwa` hub manifest field.

## Integration

The branches were merged in the requested order with `git merge --no-ff`. After each
merge, `pnpm build && pnpm typecheck && pnpm test` passed. Test totals (no servers):

| After merge | Passed | Skipped | Failed |
| --- | --- | --- | --- |
| core-surface | 6,768 | 890 | 0 |
| core-behaviour (+ fix) | 6,858 | 890 | 0 |
| channels-normalize (+ fix) | 6,992 | 890 | 0 |
| deps | 7,034 | 890 | 0 |
| open-defects (+ fix) | 7,173 | 908 | 0 |
| sandbox (+ fix) | 7,318 | 923 | 0 |

- **Conflicts that kept both sides:** `CHANGELOG.md` (every section), `llms.txt` (each
  changed line taken from its own branch, combined where both changed a line), the
  sidebars (every new migration page), the core main entry (moved names stay moved; new
  error classes and option types added), `validateConfig` (duration checks plus the
  `lang` checks), `outbound.ts` (`assertRunning` plus the split send path).
- **Duplicate work merged into one implementation.** channels-normalize and
  open-defects both fixed Discord auto-ack and timeouts, Messenger/Instagram limits and
  timeouts, unreadable local media, the Gupshup list label and the Telegram
  `retry_after` cap. Kept: Discord's token map (bare `interactionId`, token never
  leaves the provider) with the learnt application id and the rejection when no id is
  known, `autoAcknowledgeMs` as the option (`autoAckMs` deprecated alias), REST 60 s /
  uploads 5 min, autocomplete never deferred; graph-core's `graphRequest` for
  Messenger and Instagram; one local-media helper per provider; meta `v26.0` with the
  numeric `phoneNumberId` fix and the `played` status.
- **`fix: integrate core-behaviour`:** new tests imported moved names from the main
  entry (now `/internal`, `/spi`, `/testing`); `BotNotRunningError` and
  `InvalidProviderEventError` added to the main-entry pin.
- **`fix: integrate channels-normalize`:** `findSplitPoint` imported from `/internal`;
  `core/bot/outbound.ts` grew past the 500-line limit with both branches, so the
  rate-limit retry moved to `core/bot/rateLimitRetry.ts` (architecture guides updated).
- **`fix: integrate open-defects`:** SPI imports in the new core and tickets tests; new
  flow-schema/manager test documents bumped to `FLOW_DOCUMENT_VERSION` 2; Discord docs
  name `autoAcknowledgeMs` and the 60 s timeout.
- **`fix: integrate sandbox`:** the sandbox's `ws`/`vite`/`vitest` floors aligned with
  the audited versions; the final main-entry size stated (372).
- **`docs: tie the stable migration guides together`:** sidebar labels and cross-links,
  plus stale references left by the workstreams (traceparent helpers on `/spi`,
  broadcast `retries`, `botmesh_dropped_total`, the `follow-redirects` audit note, the
  eslint-plugin renames).
- **Cleanup:** the six `sr/*` branches were deleted, `git worktree prune` was run, no
  `C:/laragon/www/sr-*` directory was left, and only this campaign's containers
  (`sr-integ-*` and the `sr-integ-sb` compose project with its volumes and network) were
  removed.

### Closeout round

Three more branches were merged on top of `2726645`, one at a time with
`git merge --no-ff` (`merge: stable closeout <key>`), each followed by a green
`pnpm build && pnpm typecheck && pnpm test`:

| After merge | Passed | Skipped | Failed |
| --- | --- | --- | --- |
| co/core | 7,379 | 923 | 0 |
| co/channels | 7,416 | 925 | 0 |
| co/sandbox (+ fix) | 7,495 | 925 | 0 |
| + sqlite-store declarations fix | 7,496 | 925 | 0 |

- **co/core**: `ChaosProvider`/`RecordingProvider.selfId`; first-`ask` checkpoint of
  `.persistent()` flows; the `'stopping'` event (and `@botmesh/ai` aborting on it); one
  presence policy while disconnected (`metrics().presenceSkipped`); no chat id in two
  error messages; durable outbox split parts kept in order, linked by
  `OutboxRecord.previousPart`, with `markFailed({ refund })` so waiting behind an
  earlier part costs no retry; TypeDoc on `index`/`spi`/`testing` with 0 warnings; the
  low items (required `acknowledge`, `ctx.delete()` after stop, unknown event kinds,
  `es`/`es-MX`, `logIds`, alias tests).
- **co/channels**: Telegram poll votes (`poll_answer` → `'poll'`, non-anonymous polls by
  default, channel fallback to anonymous); Discord edits (`MESSAGE_UPDATE` with
  `edited_timestamp`, repeats dropped); meta `lang` for Flow labels and deprecations;
  `to<Channel>Error` mapper names with deprecated aliases; sqlite-store schema
  versioning; redis-store chaos tests in their own ordered vitest project, discovery
  seeded with every node and retried.
- **co/sandbox**: hub API guarded (Host/Origin, per-run token, body limits, 4xx on bad
  input, fuzzed); simulators always on 127.0.0.1; Twilio and Discord validated against
  vendored official OpenAPI fragments, which caught Discord's numeric attachment id.
- **Conflicts that kept both sides:** `CHANGELOG.md` (core and channels sections), both
  stable migration guides (the channel/store table and the sandbox token section) and
  this report (sandbox item, without the Discord-edit item the channels branch closed).
- **`fix: integrate sandbox`:** Telegram now parses `poll_answer`, so the sandbox's
  `POLL_VOTE_PARSING` lists `telegram` (its own test failed as designed), the hub sends a
  native vote there and the text on Discord; `/api/channels` is asserted per channel;
  the sandbox's Telegram config uses `pollTimeoutMs`.
- **`fix(sqlite-store): keep better-sqlite3 types out of schema.d.ts`:** `pnpm pack:smoke`
  failed in the consumer type check with `skipLibCheck: false` (TS7016) because the new
  migrations were typed with `BetterSqlite3.Database`. They now use a structural
  `SchemaDatabase`, and `tests/declarations.test.ts` walks the declarations reachable
  from `lib/index.d.ts`.
- **Cleanup:** the `co/core`, `co/channels` and `co/sandbox` branches were deleted,
  `git worktree prune` was run, no `C:/laragon/www/co-*` directory was left, and only this
  round's containers (`co-closeout-*` and the `co-closeout-sandbox` compose project with
  its volumes and network) were removed.

### API freeze round

Four branches merged on top of `4487b43` (`fix(ci): use better-sqlite3 13…`), one at a
time with `git merge --no-ff` (`merge: api freeze <key>`): `af/ai`, `af/baileys`,
`af/meta-net`, `af/redis`. After each merge `pnpm build && pnpm typecheck && pnpm test`
passed (exit code 0 for all three, every time); the final total is 7,595 passed, 925
skipped, 0 failed.

- **Conflicts that kept both sides:** `CHANGELOG.md` (every section), both stable
  migration guides (the Baileys and redis-store sections were placed under "Channel and
  store packages", before the `@botmesh/ai` and HTTP/Graph/scaffolder sections), this
  report (each package's row and bullet taken from the branch that owned it),
  `docs/public/llms.txt` (the Baileys line from `af/baileys`, the meta line from
  `af/meta-net`) and `scripts/pack-smoke.mjs` (one `refs` list with every branch's
  imports, and all the type checks).
- **`fix: integrate ai`:** the soak script loads `MockAIProvider` from
  `@botmesh/ai/testing`.
- **`fix: integrate meta-net`:** the eslint-plugin template test imports `TEMPLATES` from
  `create-botmesh/internal`.
- A stray leading space before `GenerateInput.onStreamEnd` in both migration guides was
  removed in the baileys merge.
- **Cleanup:** the four `af/*` branches were deleted and `git worktree prune` was run
  (it also dropped a stale `docs-gh-pages` worktree entry whose folder no longer existed;
  the `docs/gh-pages` branch is kept). No `C:/laragon/www/af-*` folder was left. Only
  this round's containers (`af-integ-*`, the `af-integ-sb` compose project with its
  network and volumes, and their anonymous volumes) were removed.

### Store promotion round

Branch `pp/stores` (on top of `cda0ebe`, the beta versioning commit) made
`@botmesh/postgres-store`, `@botmesh/mysql-store` and `@botmesh/mongo-store` public
(changeset `stores-public.md`, `major` from `0.1.0`). Same freeze as the other stores:

- **Drivers as peers.** `pg`, `mysql2` and `mongodb` are peer dependencies, loaded with
  `await import()` only when a store (or `PostgresDurability`) creates its own pool or
  client; a missing driver fails with an install hint. Injected pools and clients need
  nothing else.
- **No driver types in the API.** `NativePostgresPool`, `NativeMysqlPool` and
  `NativeMongoClient` are structural interfaces; `api-check` forbids driver imports
  reachable from the semver entries (`SEMVER_FORBIDDEN_IMPORTS`), and each package has a
  native-types test.
- **Names.** `logger: Partial<LoggerLike>` everywhere; mysql `PoolLike`/`ConnectionLike` →
  `MysqlPoolLike`/`MysqlConnectionLike`; mongo `ScheduleDoc` → `MongoScheduleDoc`,
  `MongoLikeSession` exported. No `@deprecated` aliases: the packages were never published.
- **Fixes found by the real-server suites.** mysql retries an auto-committed statement picked
  as deadlock victim; mongo recognises the 7.x driver's standalone "no transactions" error.
- **Coverage.** Entry-pin and packaging tests per package; `pack:smoke` installs the three
  tarballs, imports their entry and compiles a TypeScript consumer; READMEs, guides (EN/ES),
  `llms.txt`, README, AGENTS and CONTRIBUTING list them as public.

Export counts from `node scripts/api-check.cjs surface`:

| Package | Main entry before | Main entry after (deprecated) | New entries |
| --- | --- | --- | --- |
| `@botmesh/postgres-store` | 11 | 11 (0) | none |
| `@botmesh/mysql-store` | 9 | 9 (0) (2 renamed) | none |
| `@botmesh/mongo-store` | 11 | 12 (0) | none |

Checks on `pp/stores`: `pnpm api-check` OK (totals postgres-store 11, mysql-store 9,
mongo-store 12); `pnpm changeset status --verbose` plans **major** →
`1.0.0-beta.0` for the three; `pnpm pack:smoke` OK for the 13 public packages (the three stores pack at `0.1.0` until `version-packages` applies the changeset). Nothing published.

## Verification

All numbers come from the merged `main` after the API freeze round (`b7330b9` plus this
report), on Windows 11 with Node 24.13.0 and pnpm 11.9.0, unless the row says Node 22. Real
servers ran in Docker on `127.0.0.1`.

| Check | Command | Result |
| --- | --- | --- |
| Build | `pnpm build` | OK, 46 workspace projects (45 packages + the example) |
| Typecheck | `pnpm typecheck` | OK (src + tests, every package) |
| Unit tests, no servers | `pnpm test` | **7,595 passed**, 925 skipped (opt-in suites), 0 failed, 582 test files |
| Node 22 | `pnpm build && pnpm test` with portable **Node v22.23.4** (official zip, SHA-256 checked) first on `PATH` | OK: build green; **7,595 passed**, 925 skipped, 0 failed, 582 test files (same as Node 24) |
| Unit and real-server tests | `pnpm test` with every `BOTWA_TEST_*` variable | **8,639 passed**, 16 skipped, 0 failed |
| Script tests | `pnpm test:scripts` | 19/19 |
| Public API | `pnpm api-check` | OK: no missing exported types, no `any`, no `@internal`, no transport SDK type reachable from a semver entry. Totals over all entries: core 720, ai 141, baileys 114, meta 67, redis-store 51, telegram 27, graph-core 24, create-botmesh 17, http 14, sqlite-store 10 (per entry in [API decisions taken (API freeze round)](#api-decisions-taken-api-freeze-round)). |
| Tarballs | `pnpm pack:smoke` | OK for the 10 public packages. Entries imported from the tarballs: core `.`, `testing`, `testing/vitest`, `dev`, `spi`, `internal`; ai `.`, `testing`, `internal`; baileys `.`, `internal`; redis-store `.`, `internal`; create-botmesh `.`, `internal`; the 10 create-botmesh templates install and boot. Nothing published. |
| Release plan | `pnpm changeset status --verbose` | OK: 77 pending changesets. core **major** → `2.0.0-alpha.3`; ai, baileys, graph-core, http, meta, redis-store, sqlite-store, telegram, create-botmesh **major** → `1.0.0-alpha.1` (after `first-stable-1-0.md`; before it, minor → `0.2.0-alpha.1`). |
| Soak | `pnpm bench:soak` | 7 rounds of about 2,000 messages, 5,768 to 7,302 msg/s, p99 lag 35 to 46 ms, 0 errors. Heap 16.6 → 24.6 MB (936 KB/round), 22.0 MB after erasing the fresh chats. Stop under load 5 ms, no conversations left, only the 2 stdio pipes active. |
| Docs | `pnpm run docs`, `pnpm run docs:site`, `pnpm docs:check` | OK. **TypeDoc: 0 warnings.** docs-check: 0 errors, 0 warnings. Vite still prints its advisory about chunks over 1 MB (not a docs warning). |

Servers for the real-server run:

| Variables | Server |
| --- | --- |
| `BOTWA_TEST_POSTGRES_URL` | `postgres:16` |
| `BOTWA_TEST_MYSQL_URL` | `mysql:8.4` |
| `BOTWA_TEST_MONGO_URL` | `mongo:7` |
| `BOTWA_TEST_REDIS_URL` | `redis:7` |
| `BOTWA_TEST_REDIS_CLUSTER_URL` + `BOTWA_TEST_REDIS_CLUSTER_CHAOS=1` | `grokzen/redis-cluster:7.0.10`, 3 masters + 3 replicas |
| `BOTWA_TEST_EMAIL` (+ host and ports) | `greenmail/standalone:2.1.3` |
| `BOTWA_TEST_EVOLUTION_*` | Evolution API `v2.3.4` (sandbox compose) |
| `BOTWA_TEST_WPPCONNECT_*` | WPPConnect server-cli `1.3.50` (sandbox compose) |
| `BOTWA_TEST_CHATWOOT_*` | Chatwoot `v4.7.0` (sandbox compose, token from `chatwoot-token.mjs`) |
| `BOTWA_TEST_MAILPIT_*` | Mailpit `v1.27` (sandbox compose) |
| `BOTWA_TEST_OLLAMA_URL` + `BOTWA_TEST_OLLAMA_MODEL` | `ollama/ollama` with `qwen2.5:0.5b` |
| `BOTWA_TEST_SDK_UPPER_DIR` | `@anthropic-ai/sdk` 1.3.0, `openai` 7.43.0, `@google/generative-ai` 0.24.1 installed in a scratch folder |

Per-package totals in that run: core 2,361 (5 skipped), redis-store 1,051 (11 skipped),
ai 465 (Ollama live and upper-range SDK suites included), postgres-store 356,
mysql-store 317, baileys 282, mongo-store 248, meta 229, sandbox 205 (all Docker suites
included), events 192, sqlite-store 190, telegram 164, hub 153, inbox 145. The 16 skipped
are by design: core's 5 environment-gated cases and redis-store's 11 (legacy-row cases and
the single-node-only `kill -9` case). The redis-store chaos suite and the inbox/deployments
cluster suites ran in the same workspace run.

redis-store against every node-redis major, same servers, chaos on:
`BOTWA_TEST_REDIS_CLIENT=v6` (default, in the full run) 1,051 passed / 11 skipped; `v4`
1,051 / 11; `v5` 1,051 / 11. **No test was skipped or retried to get these results.**

## Remaining open items

### core

Closed in the closeout round (`co/core`; see the `[Unreleased]` section of the changelog
and the migration guides):

- `ChaosProvider.selfId` (and `RecordingProvider.selfId`) return `UserId | null`:
  no TS2420 under `exactOptionalPropertyTypes`.
- `.persistent()` flows checkpoint when they start, so a restart at the first `.ask()`
  resumes (tested with `SQLiteStore` and a restart).
- New `'stopping'` lifecycle event, before the drain and the transport stop;
  `@botmesh/ai` aborts in-flight model calls on it.
- One presence policy while disconnected: `typing`/`markRead` are a best-effort no-op,
  logged at debug and counted in `metrics().presenceSkipped` (and
  `botmesh.presence.skipped` in `@botmesh/otel`), written into the `IProvider` contract
  and checked by `assertPresenceWhileDisconnected` in every channel-contract test.
- `OutsideSessionWindowError` / `RecipientUnreachableError` default messages carry no
  chat id.
- Durable outbox: split parts keep their order on retries, are linked by
  `OutboxRecord.previousPart` (a user key ending in `#<n>` is never coupled to another
  send), waiting behind an earlier part refunds the attempt (`markFailed({ refund })`),
  and the sweeper splits an over-limit journaled record with deterministic part keys.
- TypeDoc documents `/spi` and `/testing` (named modules); `pnpm run docs` reports 0
  warnings.
- `IMessageContext.acknowledge` is required in the type; `ctx.delete()` after `stop()`
  rejects with `BotNotRunningError`; unknown event kinds are ignored; `lang` vs
  `i18n.defaultLocale` accepts `es` / `es-MX`; the `logIds` default no longer reuses a
  `'raw'` span policy; tests for the remaining deprecated aliases.

Still open (all LOW):

- With `BotConfig.coordination`, `ctx.markRead()` runs `assertCoordinated` before the
  presence gate, so after `stop()` or a lost turn it rejects (`LeaseLostError`) instead of
  being a no-op.
- `presenceSkipped` counts a skip even on a transport that has no `typing` method.
- A journaled split part that is itself over the limit is re-split by the sweeper into
  `X#2#2...`; its order against parts that `enqueue` journals later is not pinned by a
  test.
- `@botmesh/ai` now aborts on `'stopping'`, before `stop({ drain: true })` waits, so an
  autoreply that would have finished during the drain is cut; the guides do not say so
  next to `drain` yet.
- The guides say the 13 providers follow the presence policy; email and Gupshup follow
  it trivially (no presence methods), and the Baileys contract test passes even without
  its gate (no socket).
- The automatic defer of a Discord slash command is type 5 ("thinking..."), which a later
  plain channel message may not replace (channel item; confirm on a real server).
- `ctx.edit` text over the limit is not split (by design).

### Other public packages

- **ai**: the Kimi default model (`moonshot-v1-8k`) is unconfirmed (outside semver).
  Closed: helpers and wire type names moved to `/internal`, `MockAIProvider` and
  `validateArgs` to `/testing`; `PRESETS`/`DEFAULT_YES`/`DEFAULT_NO`/`AI_MESSAGES`/`AI_LOCALES`
  deep-frozen; `onStreamEnd` contract documented and tested; provider constructors take
  `AIProviderConfig`; the Azure heuristic covers `*.cognitiveservices.azure.com` and
  Foundry `/openai` endpoints.
- **baileys**: upstream `7.0.0-rc14` (no stable 7.x; pin and upgrade policy in the
  README). Closed: native types are opaque (`BaileysNativeMessage`, `BaileysSocket`,
  `BaileysAuthState`), JID helpers and mappers in `/internal`, `pairingPhoneNumber`,
  `debug` deprecated, the ffmpeg-static hint no longer loops. The `read`/`played` receipt
  note does not apply to the provider today: it emits no receipt events (no
  `messages.update` / `message-receipt.update` mapping).
- **meta**: the Cloud API typing indicator is not implemented (feature after stable).
  Closed: `GraphClient`, `toProviderError` and the verify re-exports are deprecated,
  `phoneNumberId` is typed `string | number`, and the session-window plumbing (`send`,
  `noteInbound`, `noteFailedStatus`, `RawSend`) is `@experimental` while the configuration
  and query surface stays public with semver.
- **telegram**: `callback_data` cut at 64 bytes (documented); the poll-vote tracker is
  in memory only (last 500 polls; votes on polls sent before a restart, or by another
  replica or webhook process, are dropped) and rebuilds the tally on each vote
  (O(voters x options)). Closed: `pollTimeoutMs`, `toTelegramError`, `@experimental`
  wire helpers, `debug` deprecated, `poll_answer` parsed.
- **sqlite-store**: `MemoryStore` and the other stores still accept lone surrogates.
  Closed: schema versioning, `LoggerLike` logger, `busyTimeoutMs`, the schedules/schedule_fences
  and durable tables folded into the migrations (schema version 2).
- **redis-store**: extra round trips with `maxMessagesPerChat`; the cluster test helper's connect retry does not
  destroy a client whose `connect()` failed. Closed: the node-redis 5 flake did not come
  back (v5 twice, plus v4 and v6, all green with chaos on), and a test asserts which
  major `BOTWA_TEST_REDIS_CLIENT` loads; the layout internals moved to
  `@botmesh/redis-store/internal`; the deprecated `ttl` option and `acquireLock` were removed.
- **http / graph-core**: the 413 override in graph-core only applies when the mapped
  error is a plain `ProviderError` (kept on purpose: a Graph code that says more wins).
  Closed: `SecureFetchOptions` is a closed set (no `redirect`; the other `RequestInit`
  fields through a deprecated overload until stable), `resolveHost` (alias
  `resolvePublicHost`), `checkGraphSignature({ body, headers, appSecret, logger })`
  (positional form deprecated), and graph-core is covered by semver.
- **create-botmesh**: `slashCommandsPlugin({ greeting })` still replaces the whole `/help`.
  Closed: `TEMPLATES`, `agentsMd` and `findBotMeshMonorepo` moved to
  `create-botmesh/internal`, deprecated on the main entry.
- **Across providers**: error mappers are named `to<Channel>Error` except meta, whose
  mapper is deprecated in favour of graph-core's `toGraphError`; `ingest()` return
  types still differ (documented, not unified); `debug` is deprecated in Telegram, meta
  and Baileys but not in the private providers. A `'poll'` vote event reaches the
  hooks without the access-list check, which now matters on Telegram too.

Follow-ups from the API freeze reviews (all LOW, none blocks stable):

- **Entry pins check runtime names only.** The pin tests of ai, baileys and redis-store
  list `Object.keys()` of each entry; type-only exports (`AnthropicLike`,
  `AIProviderConfig`, `BaileysNativeMessage`, `RedisKeyLayout`, the key types…) are not
  pinned. `api-check surface` lists them; a snapshot of it would pin them.
- **No `/internal` import guard outside core.** ai, baileys and redis-store have no
  equivalent of core's `internal-imports` test, so a file-path import such as
  `ai/lib/index.js` is not caught.
- **ai:** `validateArgs`/`ArgsValidation` left the main entry without an alias (cheap to
  add); `AI_LOCALES` is deep-frozen at runtime but its `readonly` type is shallow; the
  Azure heuristic needs `/openai` on `*.services.ai.azure.com` but not on
  `*.cognitiveservices.azure.com`; the `@botmesh/ai` entries are not in TypeDoc.
- **baileys:** `sameUser` keeps Baileys' behaviour for strings that are not JIDs; the
  `logger` JSDoc has a typo ("Any`LoggerLike`") in the published `.d.ts`; the ffmpeg
  hint loop is fixed for `ffmpeg-static` but not for an `FFMPEG_PATH` that points to a
  missing file; core comments in `provider.ts` and `validateConfig.ts` still say
  `pairingCode`.
- **http / graph-core:** `checkGraphSignature` treats an options object passed with any
  extra argument as the positional form; with the deprecated overload last,
  `Parameters<typeof secureFetch>[1]` resolves to `LegacySecureFetchOptions`; the
  `@ts-expect-error` assertions on `redirect`/`mode` are only checked by `pnpm typecheck`.
- **redis-store:** the `acquireLock` stub is a real prototype function (`'acquireLock' in
  store` is true); the `ttl` `TypeError` hint is built from the raw value even for values
  that were invalid before; migration 2 of sqlite-store runs the exported, mutable
  `SCHEDULES_SCHEMA`/`DURABLE_SCHEMA` constants.
- **Repo instructions:** `AGENTS.md` still says `MockAIProvider` comes from `@botmesh/ai`
  (it works through the deprecated alias; `@botmesh/ai/testing` is the documented path).

### Private packages

None is a promotion candidate yet; promoting one still means removing `"private"`,
switching `workspace:*` to `workspace:^`, a changeset and a README section.

- **channels**: webhook replay windows for Twilio, Gupshup and HighLevel (no signed
  timestamp; dedupe by id is the mitigation); TikTok and HighLevel inbound media stay
  `application/octet-stream`. Closed: Discord `MESSAGE_UPDATE` edits are parsed, and
  Discord sends `attachments[].id` as a string, as the official spec requires.
- **sandbox**: the hub API checks Host/Origin, needs a per-run token on POST, bounds
  bodies and answers bad input with a 4xx (fuzzed in `pnpm test`); Twilio and Discord
  requests are validated against vendored official OpenAPI fragments; the simulators
  always bind to 127.0.0.1; Telegram poll buttons send native votes. Still open: some
  provider error-mapping regexes are only checked against wording the sandbox itself
  produces; Meta, Gupshup, HighLevel, TikTok and Telegram have no official
  machine-readable spec; Discord votes wait for the provider to parse
  `MESSAGE_POLL_VOTE_ADD`; `token: ''` turns authentication off, and a token containing
  `$&` is spliced unescaped into the page; every simulator error is reported as 422; a
  cross-site top-level GET of the UI is refused.
- **manager**: still calls the deprecated `bot.triggerFlow`; three overlapping HTTP
  APIs; `putFlow`/`removeFlow` persist first but have no rollback if going live fails.
- **product**: `attachInbox` without `tenantId` now uses the bot's tenant (no data
  migration for conversations stored under `'local'`); the new `after` cursors need the
  cursor item to still exist; the hub manifest range type became optional.
- **plugins**: the plugins depend on core through `workspace:*`; the chatwoot, tickets,
  moderation, dialogflow and inbox-projection plugins have fixed names, so plugging two
  instances now throws unless they set `multiple`.

## Exit checklist

### Before `pre enter beta`

- [x] The six workstreams, the three closeout branches and the four API freeze branches
  merged; `pnpm build && pnpm typecheck && pnpm test` pass (7,595 tests).
- [x] Every real-server suite, the sandbox Docker suites, Ollama and the upper-range SDK
  suites pass (8,639 tests); redis-store is green on node-redis 4, 5 and 6.
- [x] `pnpm api-check`, `pnpm pack:smoke`, `pnpm test:scripts`, `pnpm bench:soak`,
  `pnpm run docs`, `pnpm docs:site` and `pnpm docs:check` pass.
- [x] `pnpm changeset status --verbose` succeeds (77 pending changesets).
- [x] Bump types decided (2026-10-26): the nine 0.x public packages move to `1.0.0`
  (changeset `first-stable-1-0.md`, `major`); `pnpm changeset status` now plans
  `1.0.0-alpha.1` for them in alpha mode, `1.0.0-beta.0` after `pre enter beta` and
  `1.0.0` after `pre exit`.
- [x] `pnpm build && pnpm test` on Node 22 (v22.23.4: 7,595 passed, 0 failed).

### During beta

- [x] Fix or record as permanent each item of the per-package table in
  [Verdict](#verdict) (the API freeze round closed them; only the Baileys rc decision
  is left).
- [x] Fix `ChaosProvider.selfId` (TS2420) and decide the first-`ask` checkpoint (both fixed).
- [ ] Settle `debug` vs `logger` in the private providers (Telegram, meta and Baileys
  are done; the error-mapper names are done and the ingest return types documented).
- [x] Add sqlite-store schema versioning.
- [ ] Watch upstream Baileys for a stable 7.x (checked 2026-10-26: `latest` is still
  `7.0.0-rc14`; policy in the Baileys README), then decide: stable on the rc pin, or
  hold only `@botmesh/baileys` at a prerelease.
- [ ] Accept only fixes and the decisions above in the public packages.

### Before stable (`pre exit`)

- [ ] No open HIGH or MEDIUM defect in any public package.
- [ ] At least one beta used for a few weeks by a real bot on Baileys, the Cloud API
  and Telegram, with no new MEDIUM defect.
- [ ] Version policy chosen: core to `2.0.0`; the 0.x packages to `1.0.0` (a `major`
  changeset for each) or kept at 0.x with that choice documented.
- [ ] Review the archived changesets in `.changeset/pre/`: `changeset pre exit` moves
  them back and they become the stable changelogs.
- [ ] `create-botmesh` stamps caret ranges without a prerelease tag (regenerated by
  `version-packages`).

### Maintainer commands (not run by this campaign, the closeout round or the API freeze round)

Run them in `main`, on a clean tree, after the checks above. Publishing to npm cannot
be undone.

From alpha to beta (Changesets v3 refuses `pre enter` while in pre mode, so leave alpha
first):

```bash
pnpm changeset status --verbose     # review the bump types first
pnpm changeset pre exit
pnpm changeset pre enter beta
pnpm changeset status --verbose     # expect core 2.0.0-beta.N and x.y.z-beta.N for the rest
pnpm changeset publish-plan
pnpm version-packages               # changeset version + create-botmesh versions.ts
git add -A && git commit -m "chore(release): version packages for the first beta"
pnpm pack:smoke
pnpm release                        # clean + build + changeset publish (dist-tag beta)
git push --follow-tags
```

From beta to stable:

```bash
pnpm changeset pre exit
pnpm changeset status --verbose     # expect stable versions, published under latest
pnpm changeset publish-plan
pnpm version-packages
git add -A && git commit -m "chore(release): version packages for the stable release"
pnpm pack:smoke
pnpm release
git push --follow-tags
```

After the first stable publish, check `npm dist-tag ls @botmesh/core` (and the same for
the other packages): `latest` should point to the stable version. Keep `alpha` and
`beta` on their last prerelease, or remove them with `npm dist-tag rm`.
