# Release readiness: stable

Go/no-go report for moving the ten public `@botmesh/*` packages to a **stable** release
(core `2.0.0`, the others at a version the maintainer picks). It closes the
stable-readiness campaign of October 2026: six workstreams, each tested by one agent and
checked by a reviewer, merged into `main` and verified together. The previous report
(the alpha → beta campaign, base `9bcba20`) gave **GO for beta** and **NO-GO for stable**
because the API freeze was still open; this campaign took those API decisions.

Date: 2026-10-26. Base: `e148ea2`. Result: six `merge: stable readiness <key>` commits,
six `fix: integrate <key>` commits, one docs commit tying the migration guides together
(see [Integration](#integration)), and this report. Nothing was published or pushed;
the repo is still in the `alpha` prerelease.

## Verdict

| Step | Decision | Why |
| --- | --- | --- |
| **alpha → beta** | **GO** | Still GO. Every check below is green on the merged `main`, including all real-server suites and the new Docker sandbox suites. |
| **beta → stable, `@botmesh/core`** | **GO after one beta** | The API freeze is done for core: the main entry went from 512 to 372 names, engine internals moved to `/internal`, a semver-covered `/spi` exists for backend authors, every concept has one canonical name (the others are `@deprecated`), and the behaviour decisions (English default, `retries`/`maxAttempts`, sends need a running bot, long-text splitting, epoch-ms timestamps) are taken, tested and documented with migration pages. What is left is a beta used by a real bot, plus two small items (see [core](#core)). |
| **beta → stable, the other nine** | **Conditional** | The dependency and behaviour blockers are fixed (Graph `v26.0`, `redis` as a peer, `@google/genai`, ffmpeg no longer bundled, English defaults, channel contract). Each package still has a short list of API-freeze items (internal helpers on the main entry, `debug` vs `logger`, a few option names). Fix them during beta, or record them as permanent, before `pre exit`. sqlite-store and baileys carry the two items that most need a decision: schema versioning and the upstream Baileys release candidate. |

Per package:

| Package | Stable verdict | Blocking before `pre exit` |
| --- | --- | --- |
| `@botmesh/core` | GO after one beta | Fix `ChaosProvider.selfId` typing (TS2420 under `exactOptionalPropertyTypes`); decide on the first-`ask` checkpoint of `.persistent()` flows (fix or keep documented). |
| `@botmesh/ai` | Conditional | Move internal helpers and wire types to `/internal`, `MockAIProvider` to `/testing`; freeze the mutable exports; settle `onStreamEnd`. |
| `@botmesh/baileys` | Conditional | Upstream is still `7.0.0-rc14` (no stable 7.x exists). Type native values as opaque, trim the JID helpers and mappers to `/internal`, rename `pairingCode`, deprecate `debug`. |
| `@botmesh/meta` | Conditional | Deprecate the duplicate `GraphClient`/`toProviderError`, stop re-exporting the verify helpers, mark the session-window plumbing `@internal`. |
| `@botmesh/telegram` | Conditional | Add `pollTimeoutMs` (deprecate `pollTimeout`), label the wire helpers `@experimental`, deprecate `debug`. |
| `@botmesh/sqlite-store` | Conditional (needs a decision) | Add `PRAGMA user_version` schema migrations before data is written by a stable release; stop exporting the DDL; align `logger` on `LoggerLike`. |
| `@botmesh/redis-store` | Conditional | Move the cluster layout internals off the main entry; remove the deprecated `ttl`/`acquireLock` options. |
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

## Verification

All numbers come from the merged `main` (`0250887` plus this report), on Windows 11
with Node 24 and pnpm 11.9.0. Real servers ran in Docker on `127.0.0.1`.

| Check | Command | Result |
| --- | --- | --- |
| Build | `pnpm build` | OK, 46 workspace projects (45 packages + the example) |
| Typecheck | `pnpm typecheck` | OK (src + tests, every package) |
| Unit tests, no servers | `pnpm test` | **7,318 passed**, 923 skipped (opt-in suites), 0 failed |
| Unit and real-server tests | `pnpm test` with every `BOTWA_TEST_*` variable | **8,357 passed**, 21 skipped, 0 failed |
| Script tests | `pnpm test:scripts` | 17/17 |
| Public API | `pnpm api-check` | OK: no missing exported types, no `any`, no `@internal`. `/internal` is no longer counted as a home for public types. Exports: core 717 (all entries), ai 135, meta 67, baileys 55, redis-store 34, telegram 23, graph-core 22, http 12, sqlite-store 8. |
| Tarballs | `pnpm pack:smoke` | OK for the 10 public packages; core entries `.`, `testing`, `testing/vitest`, `dev`, `spi`, `internal` imported from the tarball; the 10 create-botmesh templates install and boot. Nothing published. |
| Release plan | `pnpm changeset status --verbose` | OK: 59 pending changesets. core **major** → `2.0.0-alpha.3`; ai, baileys, graph-core, meta, redis-store, sqlite-store, telegram, http, create-botmesh **minor** → `0.2.0-alpha.1`. |
| Soak | `pnpm bench:soak` | 7 rounds of about 2,000 messages, 5,497 to 7,024 msg/s, p99 lag 33 to 45 ms, 0 errors. Heap 16.4 → 24.4 MB (948 KB/round), 21.8 MB after erasing the fresh chats. Stop under load 5 ms, no active handles. `i18n.reported` grows per new sender but is capped at 10,000 (`MAX_REPORTED`), which closes the earlier soak note. |
| Docs | `pnpm run docs`, `pnpm run docs:site`, `pnpm docs:check` | OK. docs-check: 0 errors, 0 warnings. TypeDoc reports 29 warnings: types that live on `/spi` or `/internal` are referenced from main-entry docs, but TypeDoc only documents `src/index.ts`. |

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
| `BOTWA_TEST_WPPCONNECT_*` | WPPConnect server-cli `1.3.50` |
| `BOTWA_TEST_CHATWOOT_*` | Chatwoot `v4.7.0` |
| `BOTWA_TEST_MAILPIT_URL` | Mailpit `v1.27` |

Per-package totals in that run: core 2,315 (5 skipped), redis-store 1,042 (11 skipped),
ai 417 (5 skipped), postgres-store 356, mysql-store 317, mongo-store 248, events 192,
email-provider 139, sandbox 126 (all Docker suites included). The 21 skipped are by
design: core's 5 legacy-row conformance cases, redis-store's 11 (legacy-row cases and
the single-node-only `kill -9` case), and ai's 2 Ollama live tests plus 3 upper-range
SDK wire tests (`BOTWA_TEST_SDK_UPPER_DIR`, which needs separately installed SDKs).

redis-store was also run against the other node-redis majors with the same servers:
`BOTWA_TEST_REDIS_CLIENT=v4` 1,042 passed / 11 skipped; `v5` first run 1 failure
(`All the root nodes are unavailable` when a hand-over test started its cluster client
right after the chaos suite's failovers), then the file (7/7) and a full rerun (1,042 /
11) passed. It is listed as an open item below. **No test was skipped or retried to get
the main results.**

## Remaining open items

### core

- MEDIUM (typing): `ChaosProvider.selfId` is typed `UserId | null | undefined` and fails
  `implements IProvider` under `exactOptionalPropertyTypes` (TS2420). Small fix.
- MEDIUM (documented): `.persistent()` writes no checkpoint on its first `.ask()`
  unless durability or coordination is on.
- LOW: `IMessageContext.acknowledge` is optional in the type though always present.
- LOW: `OutsideSessionWindowError`'s default message embeds the chat id (providers pass
  their own message).
- LOW (to confirm on a real server): the automatic defer of a Discord slash command is
  type 5 ("thinking…"), which a later plain channel message may not replace. Answering
  with `ctx.acknowledge(text)` first avoids it.
- LOW (ops): AI calls are aborted on `'stopped'`, after the transport stopped; an
  earlier `'stopping'` hook would need a lifecycle event.
- Durable `bot.enqueue` now splits long text into journaled parts; the sweeper sends
  them as journaled. `ctx.edit` text over the limit is not split (by design).
- TypeDoc covers only the main entry (29 warnings for `/spi` and `/internal` types).
- Leftovers noted by reviewers: tests for every deprecated alias (only the most used
  are exercised), the `logIds` default reusing a `'raw'` tracing id policy, the
  `BotNotRunningError` guard not covering `markRead`/`deleteMessage`, unknown event
  kinds reported instead of ignored (forward compatibility), and `lang` vs
  `i18n.defaultLocale` compared by exact tag (`es` vs `es-MX` throws).

### Other public packages

- **ai**: internal helpers, wire types and `MockAIProvider` on the main entry; mutable
  `DEFAULT_YES`/`DEFAULT_NO`/`PRESETS`/`AI_LOCALES`; `onStreamEnd` callback; provider
  constructors take the whole `AIConfig`; the Azure host heuristic for `max_tokens`
  covers only `*.openai.azure.com`; the Kimi default model is unconfirmed.
- **baileys**: upstream `7.0.0-rc14` (no stable 7.x); native types leak (`WAMessage`,
  `socket`, `auth`); `markRead`/`typing` do nothing while disconnected; a `read` and a
  `played` receipt can both arrive for one voice note; when `ffmpeg-static` is
  installed without its binary the error hint loops.
- **meta**: duplicate `GraphClient`/`toProviderError`; three ways to verify a webhook;
  the numeric `phoneNumberId` is accepted at runtime but the config type is `string`;
  the Cloud API typing indicator is not implemented (feature after stable).
- **telegram**: `pollTimeout` in seconds; `callback_data` cut at 64 bytes (documented);
  `poll_answer` updates are not parsed.
- **sqlite-store**: no schema versioning; `logger` is `{ error? }`; no `busyTimeout`.
  `MemoryStore` and the other stores still accept lone surrogates.
- **redis-store**: layout internals exported; deprecated `ttl`/`acquireLock`; extra
  round trips with `maxMessagesPerChat`; the node-redis 5 cluster-discovery flake above;
  no test asserts which major `BOTWA_TEST_REDIS_CLIENT` loads.
- **http / graph-core**: `SecureFetchOptions extends RequestInit`; `resolvePublicHost`
  naming; four positional arguments in `checkGraphSignature`; the 413 override in
  graph-core only applies when the mapped error is a plain `ProviderError`.
- **create-botmesh**: `TEMPLATES`, `agentsMd` and `findBotMeshMonorepo` are public;
  `slashCommandsPlugin({ greeting })` still replaces the whole `/help`.
- Ingest return types and error-mapper names still differ per provider; `debug` vs
  `logger` is not settled in any provider.

### Private packages

None is a promotion candidate yet; promoting one still means removing `"private"`,
switching `workspace:*` to `workspace:^`, a changeset and a README section.

- **channels**: webhook replay windows for Twilio, Gupshup and HighLevel (no signed
  timestamp; dedupe by id is the mitigation); Discord `MESSAGE_UPDATE` edits are not
  parsed; TikTok and HighLevel inbound media stay `application/octet-stream`.
- **sandbox** (new): the hub's JSON API has no Origin/Host check (a local web page can
  post to it); prototype keys in the channel lookup return 500; `startHarness` does not
  clean up after a partial failure; the signature-rejection tests post empty payloads;
  some error-mapping regexes are only checked against wording the sandbox itself
  produces. Requests are validated against schemas written from the docs, not the
  official OpenAPI specs.
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

- [x] The six workstreams merged; `pnpm build && pnpm typecheck && pnpm test` pass
  (7,318 tests).
- [x] Every real-server suite and the new sandbox Docker suites pass (8,357 tests).
- [x] `pnpm api-check`, `pnpm pack:smoke`, `pnpm test:scripts`, `pnpm bench:soak`,
  `pnpm run docs`, `pnpm docs:site` and `pnpm docs:check` pass.
- [x] `pnpm changeset status --verbose` succeeds (59 pending changesets).
- [ ] The maintainer reviews the bump types. The channel and dependency changesets use
  **minor** bumps with **Breaking** notes for the 0.x packages, to keep them on
  `0.2.0-alpha.1` in pre mode; switch them to `major` if the 0.x packages should move
  to `1.0.0`.
- [ ] Optional: one `pnpm test` on a quiet machine on Node 22 and Node 24, and the
  Ollama and upper-range SDK opt-in suites.

### During beta

- [ ] Fix or record as permanent each item of the per-package table in
  [Verdict](#verdict).
- [ ] Fix `ChaosProvider.selfId` (TS2420) and decide the first-`ask` checkpoint.
- [ ] Settle `debug` vs `logger` and the ingest/error-mapper names across providers.
- [ ] Add sqlite-store schema versioning.
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

### Maintainer commands (not run by this campaign)

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
