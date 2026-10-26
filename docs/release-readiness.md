# Release readiness: stable

Go/no-go report for moving the ten public `@botmesh/*` packages to a **stable** release
(core `2.0.0`, the others at a version the maintainer picks). It closes the
stable-readiness campaign of October 2026: six workstreams, each tested by one agent and
checked by a reviewer, merged into `main` and verified together. The previous report
(the alpha → beta campaign, base `9bcba20`) gave **GO for beta** and **NO-GO for stable**
because the API freeze was still open; this campaign took those API decisions.

Date: 2026-10-26. Base: `e148ea2`. Result: six `merge: stable readiness <key>` commits,
six `fix: integrate <key>` commits, one docs commit tying the migration guides together
(see [Integration](#integration)), and this report. A closeout round then merged three
more branches on top of `2726645` (`co/core`, `co/channels`, `co/sandbox`; see
[Closeout round](#closeout-round)); the verdicts and numbers below are from after it.
Nothing was published or pushed; the repo is still in the `alpha` prerelease.

## Verdict

| Step | Decision | Why |
| --- | --- | --- |
| **alpha → beta** | **GO** | Still GO. Every check below is green on the merged `main`, including all real-server suites and the new Docker sandbox suites. |
| **beta → stable, `@botmesh/core`** | **GO after one beta** | The API freeze is done for core: the main entry went from 512 to 372 names, engine internals moved to `/internal`, a semver-covered `/spi` exists for backend authors, every concept has one canonical name (the others are `@deprecated`), and the behaviour decisions (English default, `retries`/`maxAttempts`, sends need a running bot, long-text splitting, epoch-ms timestamps, presence while disconnected, the `'stopping'` event) are taken, tested and documented with migration pages. No core item from the previous report is left open; what remains is a beta used by a real bot (see [core](#core)). |
| **beta → stable, `@botmesh/telegram`, `@botmesh/sqlite-store`** | **GO after one beta** | Their API-freeze lists are done: Telegram has `pollTimeoutMs`, `toTelegramError`, `@experimental` wire helpers and parses poll votes; sqlite-store has `PRAGMA user_version` migrations, refuses newer files untouched, `busyTimeoutMs` and a `LoggerLike` logger. |
| **beta → stable, the other seven** | **Conditional** | The dependency and behaviour blockers are fixed (Graph `v26.0`, `redis` as a peer, `@google/genai`, ffmpeg no longer bundled, English defaults, channel contract, one presence policy). Each package still has a short list of API-freeze items (internal helpers on the main entry, `debug` vs `logger` in Baileys, a few option names). Fix them during beta, or record them as permanent, before `pre exit`. Baileys carries the item that most needs a decision: the upstream release candidate. |

Per package:

| Package | Stable verdict | Blocking before `pre exit` |
| --- | --- | --- |
| `@botmesh/core` | GO after one beta | None. Every core item of the previous report is closed (see [core](#core)). |
| `@botmesh/ai` | Conditional | Done: helpers and wire type names in `/internal`, `MockAIProvider` in `/testing` (deprecated main alias), exported data frozen, `onStreamEnd` contract fixed (main entry 135 → 97). Left: confirm the Kimi default model. |
| `@botmesh/baileys` | Conditional | Upstream is still `7.0.0-rc14` (no stable 7.x exists). Type native values as opaque, trim the JID helpers and mappers to `/internal`, rename `pairingCode`, deprecate `debug`. |
| `@botmesh/meta` | Conditional (small) | Done: `GraphClient`, `toProviderError`, the verify re-exports and `debug` are `@deprecated`; `phoneNumberId` is `string \| number`; `lang` for Flow labels. Left: decide whether the session-window plumbing (`SessionWindowManager`, `MemorySessionWindowStore`…) stays public or becomes `@internal`. |
| `@botmesh/telegram` | GO after one beta | None. `pollTimeoutMs` (alias `pollTimeout`), `toTelegramError`, `@experimental` wire helpers, `debug` deprecated, poll votes parsed. |
| `@botmesh/sqlite-store` | GO after one beta | None. Schema migrations via `PRAGMA user_version`, newer files refused untouched (`SQLiteSchemaVersionError`), DDL exports deprecated, `logger: Partial<LoggerLike>`, `busyTimeoutMs`. The schedules and durable tables are still created ad hoc, outside the version (record or fold in during beta). |
| `@botmesh/redis-store` | Conditional | Move the cluster layout internals off the main entry; remove the deprecated `ttl`/`acquireLock` options. The node-redis 5 cluster flake did not reproduce in this round (see [Verification](#verification)). |
| `@botmesh/http`, `@botmesh/graph-core` | Conditional | Narrow `SecureFetchOptions`; options object for `checkGraphSignature`; decide whether semver covers graph-core. |
| `create-botmesh` | Conditional (low risk) | Mark `TEMPLATES`, `agentsMd` and `findBotMeshMonorepo` `@internal`. |

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

## Verification

All numbers come from the merged `main` after the closeout round (`099adf5` plus this
report), on Windows 11 with Node 24.13 and pnpm 11.9.0. Real servers ran in Docker on
`127.0.0.1`.

| Check | Command | Result |
| --- | --- | --- |
| Build | `pnpm build` | OK, 46 workspace projects (45 packages + the example) |
| Typecheck | `pnpm typecheck` | OK (src + tests, every package) |
| Unit tests, no servers | `pnpm test` | **7,496 passed**, 925 skipped (opt-in suites), 0 failed, 572 test files |
| Unit and real-server tests | `pnpm test` with every `BOTWA_TEST_*` variable | **8,540 passed**, 16 skipped, 0 failed |
| Script tests | `pnpm test:scripts` | 17/17 |
| Public API | `pnpm api-check` | OK: no missing exported types, no `any`, no `@internal`. Exports: core 720 (all entries), ai 135, meta 67, baileys 55, redis-store 34, telegram 27, graph-core 22, http 12, sqlite-store 10. |
| Tarballs | `pnpm pack:smoke` | OK for the 10 public packages (after the sqlite-store declarations fix; the first run failed with TS7016); core entries `.`, `testing`, `testing/vitest`, `dev`, `spi`, `internal` imported from the tarball; the 10 create-botmesh templates install and boot. Nothing published. |
| Release plan | `pnpm changeset status --verbose` | OK: 67 pending changesets. core **major** → `2.0.0-alpha.3`; ai, baileys, graph-core, meta, redis-store, sqlite-store, telegram, create-botmesh **minor** → `0.2.0-alpha.1`; http **patch** → `0.2.0-alpha.1`. |
| Soak | `pnpm bench:soak` | 7 rounds of about 2,000 messages, 5,077 to 7,073 msg/s, p99 lag 35 to 63 ms, 0 errors. Heap 16.6 → 24.5 MB (942 KB/round), 22.0 MB after erasing the fresh chats. Stop under load 6 ms, no conversations left, only the 2 stdio pipes active. |
| Docs | `pnpm run docs`, `pnpm run docs:site`, `pnpm docs:check` | OK. **TypeDoc: 0 warnings.** docs-check: 0 errors, 0 warnings. Vite still prints its advisory about chunks over 1 MB (not a docs warning). |

Servers for the real-server run:

| Variables | Server |
| --- | --- |
| `BOTWA_TEST_POSTGRES_URL` | `postgres:16` |
| `BOTWA_TEST_MYSQL_URL` | `mysql:8.4` |
| `BOTWA_TEST_MONGO_URL` | `mongo:7` |
| `BOTWA_TEST_REDIS_URL` | `redis:7` |
| `BOTWA_TEST_REDIS_CLUSTER_URL` + `BOTWA_TEST_REDIS_CLUSTER_CHAOS=1` | `grokzen/redis-cluster:7.0.10`, 3 masters + 3 replicas |
| `BOTWA_TEST_EMAIL` | `greenmail/standalone:2.1.3` |
| `BOTWA_TEST_EVOLUTION_*` | Evolution API `v2.3.4` (sandbox compose) |
| `BOTWA_TEST_WPPCONNECT_*` | WPPConnect server-cli `1.3.50` |
| `BOTWA_TEST_CHATWOOT_*` | Chatwoot `v4.7.0` |
| `BOTWA_TEST_MAILPIT_URL` | Mailpit `v1.27` |
| `BOTWA_TEST_OLLAMA_URL` + `BOTWA_TEST_OLLAMA_MODEL` | `ollama/ollama` with `qwen2.5:0.5b` |
| `BOTWA_TEST_SDK_UPPER_DIR` | `@anthropic-ai/sdk` 1.3, `openai` 7.43, `@google/generative-ai` 0.24.1 installed in a scratch folder |

Per-package totals in that run: core 2,361 (5 skipped), redis-store 1,046 (11 skipped),
ai 423 (Ollama live and upper-range SDK suites included), postgres-store 356,
mysql-store 317, mongo-store 248, sandbox 205 (all Docker suites included), events 192,
sqlite-store 184, inbox 145, email-provider 140, deployments 138. The 16 skipped are by
design: core's 5 environment-gated cases and redis-store's 11 (legacy-row cases and the
single-node-only `kill -9` case). The full run had the redis-store chaos suite and the
inbox/deployments cluster suites in the same workspace run, and it passed.

redis-store against every node-redis major, same servers, chaos on:
`BOTWA_TEST_REDIS_CLIENT=v6` (default) 1,046 passed / 11 skipped; `v4` 1,046 / 11;
`v5` twice in a row, 1,046 / 11 both times. The earlier `v5` flake (`All the root nodes
are unavailable` after the chaos failovers) did not come back. Standalone runs also
passed: postgres-store 356, mysql-store 317, mongo-store 248, email (GreenMail) 140,
sandbox Docker suites 15/15. **No test was skipped or retried to get these results.**

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
- **baileys**: upstream `7.0.0-rc14` (no stable 7.x); native types leak (`WAMessage`,
  `socket`, `auth`); `debug` not deprecated yet; a `read` and a `played` receipt can both
  arrive for one voice note; when `ffmpeg-static` is installed without its binary the
  error hint loops.
- **meta**: the session-window plumbing is still public; the Cloud API typing indicator
  is not implemented (feature after stable). Closed: `GraphClient`, `toProviderError` and
  the verify re-exports are deprecated, `phoneNumberId` is typed `string | number`.
- **telegram**: `callback_data` cut at 64 bytes (documented); the poll-vote tracker is
  in memory only (last 500 polls; votes on polls sent before a restart, or by another
  replica or webhook process, are dropped) and rebuilds the tally on each vote
  (O(voters x options)). Closed: `pollTimeoutMs`, `toTelegramError`, `@experimental`
  wire helpers, `debug` deprecated, `poll_answer` parsed.
- **sqlite-store**: the schedules/schedule_fences and durable tables are created outside
  the schema version; `MemoryStore` and the other stores still accept lone surrogates.
  Closed: schema versioning, `LoggerLike` logger, `busyTimeoutMs`.
- **redis-store**: layout internals exported; deprecated `ttl`/`acquireLock`; extra
  round trips with `maxMessagesPerChat`; the cluster test helper's connect retry does not
  destroy a client whose `connect()` failed. Closed: the node-redis 5 flake did not come
  back (v5 twice, plus v4 and v6, all green with chaos on), and a test asserts which
  major `BOTWA_TEST_REDIS_CLIENT` loads.
- **http / graph-core**: `SecureFetchOptions extends RequestInit`; `resolvePublicHost`
  naming; four positional arguments in `checkGraphSignature`; the 413 override in
  graph-core only applies when the mapped error is a plain `ProviderError`.
- **create-botmesh**: `TEMPLATES`, `agentsMd` and `findBotMeshMonorepo` are public;
  `slashCommandsPlugin({ greeting })` still replaces the whole `/help`.
- **Across providers**: error mappers are named `to<Channel>Error` except meta, whose
  mapper is deprecated in favour of graph-core's `toGraphError`; `ingest()` return
  types still differ (documented, not unified); `debug` is deprecated in Telegram and
  meta but not in Baileys or the private providers. A `'poll'` vote event reaches the
  hooks without the access-list check, which now matters on Telegram too.

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

- [x] The six workstreams and the three closeout branches merged;
  `pnpm build && pnpm typecheck && pnpm test` pass (7,496 tests).
- [x] Every real-server suite, the sandbox Docker suites, Ollama and the upper-range SDK
  suites pass (8,540 tests); redis-store is green on node-redis 4, 5 (twice) and 6.
- [x] `pnpm api-check`, `pnpm pack:smoke`, `pnpm test:scripts`, `pnpm bench:soak`,
  `pnpm run docs`, `pnpm docs:site` and `pnpm docs:check` pass.
- [x] `pnpm changeset status --verbose` succeeds (67 pending changesets).
- [ ] The maintainer reviews the bump types. The channel and dependency changesets use
  **minor** bumps with **Breaking** notes for the 0.x packages, to keep them on
  `0.2.0-alpha.1` in pre mode; switch them to `major` if the 0.x packages should move
  to `1.0.0`.
- [ ] Optional: one `pnpm test` on Node 22 (this round ran on Node 24 only).

### During beta

- [ ] Fix or record as permanent each item of the per-package table in
  [Verdict](#verdict).
- [x] Fix `ChaosProvider.selfId` (TS2420) and decide the first-`ask` checkpoint (both fixed).
- [ ] Settle `debug` vs `logger` in Baileys and the private providers (Telegram and meta
  are done; the error-mapper names are done and the ingest return types documented).
- [x] Add sqlite-store schema versioning.
- [ ] Watch upstream Baileys for a stable 7.x.
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

### Maintainer commands (not run by this campaign or the closeout round)

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
