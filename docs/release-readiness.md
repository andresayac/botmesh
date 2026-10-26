# Release readiness: leaving alpha

Go/no-go report for moving the public `@botmesh/*` packages from the `alpha` dist-tag
to beta and then to stable. It closes the release-readiness campaign of October 2026:
fourteen review areas, each tested by one agent and checked by a second reviewer, all
merged into `main` and verified together.

Date: 2026-10-25. Base: `9bcba20`. Result: the fourteen `merge: release readiness <area>`
commits, one integration fix and one release-tooling fix (see
[Integration](#integration)).

## Verdict

| Step | Decision | Why |
| --- | --- | --- |
| **alpha → beta** | **GO** | All 14 areas say *ready for beta*. 163 defects were fixed with tests first. The full suite, the API check, the tarball smoke test, the real-server suites, the soak test and the docs build are all green on the merged `main` (numbers below). The one release blocker found during integration (archived changesets still used the old `@bot-wa/*` names, so `changeset version` could not run) is fixed. |
| **beta → stable** | **NO-GO for now** | No defect blocks stable on its own. What blocks it is the **API freeze**. Several breaking decisions are still open: the default locale is Spanish, `retries` means total attempts, the core main entry exports 686 symbols, the AI SDK and Graph versions are pinned, the Baileys dependency is a release candidate, and old `botwa` names remain. A stable release would freeze all of these until the next major. Beta is the last window to change them. |

Reviewers disagreed with the tester in two areas (core-runtime and platform). In both
cases the reviewer found a defect the tester had missed: native media was rejected by
the new outbound check, and the form-pattern ReDoS fix could be bypassed. Both were
fixed on the branch before it was merged (`fix(core): accept native media and retry
short ctx rate limits`, `fix(flow-schema): match form patterns in linear time, cap
inlined subflows`). The verdict for both areas is *ready for beta*.

## Verification

All numbers come from the merged `main` (`844f951` plus this report). The machine was
Windows 11 with Node 24 and pnpm 11.9.0. The real servers ran in Docker on
`127.0.0.1`.

| Check | Command | Result |
| --- | --- | --- |
| Build | `pnpm build` | OK, 45 workspace projects |
| Typecheck | `pnpm typecheck` | OK (src + tests, every package) |
| Unit tests, no servers | `pnpm test` | **6,664 passed**, 890 skipped (integration suites with no server), 0 failed, 45 projects |
| Unit and real-server tests | `pnpm test` with every `BOTWA_TEST_*` server variable set | **7,673 passed**, 18 skipped, 0 failed, 45 projects |
| Script tests | `pnpm test:scripts` | 17/17 (including the new changeset-name check) |
| Public API | `pnpm api-check` | OK: no missing exported types, no `any`, no `@internal` in the public `.d.ts` |
| Tarballs | `pnpm pack:smoke` (full) | OK for the 10 public packages. Each was installed from its tarball and type-checked. Nothing was published. |
| Soak | `pnpm bench:soak` | 7 rounds of about 2,000 messages each, 5,900 to 7,400 msg/s, p99 event-loop lag 31 to 43 ms. 0 errors. Heap went from 16.1 to 24.1 MB (about 0.9 MB per round, 21.5 MB after erasing the fresh chats). Stopping under load took 5 ms and left no active handles. |
| Docs | `pnpm run docs`, `pnpm run docs:site`, `pnpm docs:check` | OK. TypeDoc and VitePress build; docs-check reports 0 errors and 0 warnings. |
| Release plan | `pnpm changeset status --verbose` | OK after the fix: 27 pending changesets bump all 10 public packages (core to `2.0.0-alpha.3`, the rest to `x.y.z-alpha.1`) |

Real servers used for the second run, with every variable the suites read:

| Variable | Server |
| --- | --- |
| `BOTWA_TEST_POSTGRES_URL` | `postgres:16` |
| `BOTWA_TEST_MYSQL_URL` | `mysql:8.4` |
| `BOTWA_TEST_MONGO_URL` | `mongo:7` |
| `BOTWA_TEST_REDIS_URL` | `redis:7` |
| `BOTWA_TEST_REDIS_CLUSTER_URL` + `BOTWA_TEST_REDIS_CLUSTER_CHAOS=1` | `grokzen/redis-cluster:7.0.10`, 3 masters and 3 replicas |
| `BOTWA_TEST_EMAIL` (+ host and ports) | `greenmail/standalone:2.1.3` |

Per-package totals in the real-server run included: postgres-store 356, mysql-store
314, mongo-store 245, redis-store 1,040 (11 skipped), email-provider 135, events 188
and core 2,059 (5 skipped).

The 18 skipped tests in that run are:

- 2 in `ai`: the Ollama live smoke test (`BOTWA_TEST_OLLAMA_URL`/`_MODEL`). It was not run, because it needs a model download and it is not part of the store/email matrix.
- 11 in `redis-store`: by design. Most are shared store-conformance cases that skip themselves at run time (`ctx.skip()`) when a store variant has no legacy rows; one is the `kill -9` hand-over case, which runs only on single-node Redis.
- 5 in `core`: the legacy-row conformance cases, which do not apply to `MemoryStore`.

Machine load caused timing-test timeouts during the campaign. They occurred in
`events` shared-file-journal, core `durability-hardening` and `internal-imports`, and
the redis-store crash matrix. The branches widened those margins or made the waits
event-driven (core-runtime, core-ops and plugins). None of these timing failures
occurred in the 16 full runs of this integration (one after each merge, plus two
re-checks) or in the final runs above. The only red run was the
product merge, which was a real integration mismatch (see below). **No test was skipped
or retried to get a green result.**

## Integration

The branches were merged in campaign order with `git merge --no-ff`. After each merge,
`pnpm build && pnpm typecheck && pnpm test` passed. Per-merge test totals grew from
6,006 to 6,664.

- **Conflicts resolved, keeping both fixes:**
  - The scheduler guide (EN/ES) conflicted between the cron range checks in core-runtime and core-ops: the core-ops text was kept and the `every()`/`delay()` rule from core-runtime added.
  - In `durability-hardening.test.ts`, the wider core-ops margins were kept together with the core-runtime wait for inbox confirmation.
  - The store guide (EN/ES) combined the core-runtime resume note with the stores-public checkpoint and reopen notes.
  - `llms.txt` took each changed line from its own branch.
  - `CHANGELOG.md` kept every entry.
- **Auto-merge fixed by hand:** `scheduler/cron.ts` ended up with two validation loops and two `CRON_BOUNDS` declarations, one from core-runtime and one from core-ops. Only the core-ops version was kept: it adds the impossible-date check, and `cron-validation.test.ts` pins its error messages.
- **`fix: integrate product`:** rr/platform stopped re-exporting `normalizeGateResult`, and rr/product removed its `@internal` tag. Combined, the function was neither exported nor internal, so the platform `public-api` test found no `@internal` symbols. The function is now `@internal` and unexported. The test also catches tags that close the JSDoc on the next line, and the contradictory CHANGELOG sentence was corrected.
- **`fix(release)`, found while preparing this report:** all 123 changesets archived in `.changeset/pre/` by the first alpha still named `@bot-wa/*` and `create-bot-wa`. As a result `changeset status` failed and `changeset version` could not run. `changeset pre exit` would also have restored them under those names. They now name the current packages. `scripts/smoke/changesets.test.mjs` (in `pnpm test:scripts`) fails if any pending or archived changeset names a package that is not in the workspace.
- Cleanup: all 14 `rr/*` branches were deleted, `git worktree prune` was run and the leftover `C:/laragon/www/rr-plugins` directory was removed. Only this campaign's Docker containers were removed.

## Public packages

Each entry has the verdict, the open defects by severity and the API-freeze concerns,
each with a recommendation. "Tests" counts the cases of the package's own suite in the
real-server run.

### @botmesh/core (`2.0.0-alpha.2`)

**Verdict: ready for beta.** 19 fixes were made in the core-runtime and core-ops areas.
Tests: 2,059 passed, 5 skipped. Main entry: 686 exports.

**Open defects**

- MEDIUM: plain text longer than `capabilities.maxTextLength` is not split. `ctx.reply` rejects with `PayloadTooLargeError` on Telegram (4,096), Discord and Messenger (2,000) and Instagram (1,000 bytes). Only `ctx.stream()` honours the limit. Recommendation: chunk in the outbound path before stable.
- MEDIUM: `flow().persistent()` writes no checkpoint while it waits on its *first* `.ask()`, unless durability or coordination is on, so a restart at that point loses the user's place. This is now documented. Recommendation: always `save(0)` for persistent flows, and run the coordination, durability, handover and wave-i suites.
- MEDIUM: the unit of `ctx.timestamp` is undocumented and differs per provider (Meta uses epoch seconds, Telegram epoch ms). Recommendation: declare epoch ms in the contract and convert in providers before any provider goes stable.
- MEDIUM (typing): with `exactOptionalPropertyTypes` and `skipLibCheck: false`, `ChaosProvider` and `RecordingProvider` (`/testing`) declare `selfId: UserId | null | undefined`, which does not satisfy `IProvider` (TS2420). Recommendation: type it `UserId | null`.
- LOW: the following are fixed only in part or are rough edges:
  - Sends before `start()` and after `stop()` reach the provider.
  - Concurrent `start`/`stop`/`start` calls have no clear final state.
  - The same plugin can be plugged twice.
  - `choose({})` fails only at run time.
  - Malformed provider events surface as a generic `TypeError`.
  - Calling `next()` twice in a hook drops the message.
  - `bot.stop()` does not settle in-flight inbound persistence.
  - `MemoryKv` resets versions after `remove()` (ABA) and accepts `limit: Infinity`.
  - Debug logs include the raw sender id.
  - Some config validation is loose: `telemetry.idKey ''`, `scheduler.lease {}`, and `handover.ttl` errors that do not name the option.
- LOW (file journals): a corrupt line in the *middle* of the append log is treated as a torn tail, so the later entries are dropped silently. Snapshots are never fsynced. `MemoryCoordinationHub` keeps state for every chat forever.
- LOW (soak): `i18n.reported` grows by about 12 entries per round. It is small, but confirm that it is bounded.

**API freeze**

- The main entry is too large to freeze. It includes the engine classes (Dispatcher, ConversationRuntime, HookSystem, Scheduler, I18n, KvInbox/KvOutbox, InboundDeduper), backend SPI helpers (MemoryKv, computeBackoff, isScheduleClaimable…), the reference coordinators (`MemoryCoordinator`, `MemoryCoordinationHub`) and the `@deprecated` re-exports of `@botmesh/core/internal`. Recommendation: before stable, drop the deprecated re-exports (2.0 is still a prerelease), move the engine classes to `/internal`, add an `/spi` subpath for backend authors, and move the memory coordinators to `/testing`.
- Built-in texts default to Spanish (`defaultLocale 'es'`, `omitir`, `Demasiados intentos`), while the READMEs and the npm pages are in English. Recommendation: default to `en`, or require an explicit choice, **during beta**. After stable this is a breaking change.
- `retries: N` on conversations means N total attempts, but `outbox.retries` means attempts after the first. Recommendation: use one meaning, or rename to `maxAttempts`.
- Aliases to trim before freezing:
  - `ctx.reply`/`say`/`answer`/`text`
  - `flow`/`addKeyword`
  - `send`/`sendText`/`sendTo`/`enqueue`
  - `use` vs `plug`
  - `trigger`/`triggerFlow`/`enterConversation`
  - `useFlow`/`registerFlow`
  - `onImage`/`when(IMAGE)`/`onType`
  - `Config`/`BotConfig`
  - `AccessList`/`Whitelist`

  Recommendation: choose one canonical name for each and mark the rest `@deprecated`.
- Duration options are named inconsistently: `*Ms` options also accept `'15s'`, while `retention` and `handover.ttl` have no suffix. `durability.journal` holds a `DurabilityBackend`. Leadership has two concepts (`LeaseProvider` vs `Coordinator`). `FileDurability.open()` is an async factory, while the other backends use a constructor plus `start()`. Recommendation: one convention for each.
- `BotConfig.storeConfig: Record<string, unknown>` is untyped. Recommendation: type it or deprecate it. Flow `.do()` steps get a `RuntimeMessage`, while conversations get a `MessageContext`, and there are two conversation handler types. Recommendation: unify them.
- `IMessageContext.acknowledge` is optional in the type but always present. Recommendation: make it required, so that `await ctx.acknowledge()` compiles in strict mode.
- `LoggerLike` is variadic and has no documented calling convention. Recommendation: document the pino-style `(obj, msg)` call as the contract.
- Transcript recording is exported from both the main entry and `/testing`. Recommendation: keep it in one place.
- The default Prometheus prefix (`botwa_`), the default Redis prefix (`botwa`), the events channel (`botwa:durable`) and the `BOTWA_TEST_*` variable names still use the old name. Recommendation: decide now whether to rename them with a migration or to document them as permanent.

### @botmesh/ai (`0.2.0-alpha.0`)

**Verdict: ready for beta.** 13 fixes. Tests: 384 passed, 2 skipped (Ollama live).
Main entry: 132 exports.

**Open defects**

- LOW:
  - `toGeminiSchema` does not recurse into `anyOf`/`oneOf`/`allOf`, so a zod `.nullable()` schema may be rejected by Gemini.
  - An `openai` provider with a custom `baseUrl` always sends `max_completion_tokens`.
  - `timeoutMs` is a hard per-call timeout when not streaming but an idle timeout when streaming.
  - `memory.maxFactLength` is not validated.
  - An invalid `memory.ttl` fails at `plug()` rather than at `aiPlugin()`.
- LOW (reviewer):
  - Aborting on stop frees the turn only if the provider honours the signal.
  - The abort runs on the `'stopped'` event, after the transport has stopped.
  - The one-line guarantee of `keyLabel` ignores NEL and bidi controls.
  - The new peer ranges are tested in the repo only at their lower end.

**API freeze**

- Move the internal helpers (`runToolLoop`, `validateArgs`, `ToolLedger`, `toGeminiSchema`…) and every provider's wire types to `@botmesh/ai/internal`, and `MockAIProvider` to `@botmesh/ai/testing`.
- `@google/generative-ai` has been replaced upstream by `@google/genai`. Moving to the new SDK changes the peer that users install, which is breaking. Recommendation: switch during beta, or mark the Gemini provider experimental.
- The default models (`claude-opus-4-8`, `gemini-2.0-flash`, preset defaults such as `grok-2-latest`) will age. Recommendation: state that default models are outside semver, or require `model` for presets.
- The provider constructors take the whole `AIConfig`. Recommendation: narrow it to a provider options type. There are also two ways to customise texts (options vs the `ai.*` i18n keys); keep one.
- `GenerateInput.onStreamEnd` is a callback. Recommendation: return `stopReason`/`usage` on the stream result before `AIProvider` is frozen as an extension point.
- `DEFAULT_YES`, `DEFAULT_NO`, `PRESETS` and `AI_LOCALES` are mutable exports. Recommendation: freeze them.
- `chatKeyOf` ignores `BotConfig.conversationScope`.
- The `definePlugin` version is hard-coded to `0.1.0`, the package description omits Gemini and the presets, and there is no `./package.json` export.

### @botmesh/baileys (`0.2.0-alpha.0`)

**Verdict: ready for beta.** 19 fixes. Tests: 243 passed. Main entry: 53 exports.

**Open defects**

- MEDIUM: the package depends on an upstream **release candidate**, an exact pin to `@whiskeysockets/baileys@7.0.0-rc14`. Its preinstall script crashes under pnpm on Node 24 when builds are allowed (the documented workaround is to deny the build). A stable `@botmesh/baileys` on an upstream RC is a risk. Recommendation: track upstream 7.0.0 final, or label the package "stable API, upstream RC".
- MEDIUM: `fluent-ffmpeg` is deprecated and `@ffmpeg-installer/ffmpeg` is unmaintained (it ships an old ffmpeg). Recommendation: make ffmpeg an optional peer or use the system binary.
- LOW:
  - Message edits are dropped, not delivered as edits.
  - A conversation started under a bare LID is orphaned once the PN is learned (documented).
  - `markRead`/`typing` do nothing when disconnected, while `send` rejects.
  - `toJid({ groupId, userId })` returns an invalid JID.
  - The rate-limiter sleeps are not cancellable.
  - The reconnect policy is not configurable.
  - Upstream rc14 throws on number-change notices.

**API freeze**

- The public types leak Baileys internals: `IProvider<WAMessage>`, plus `socket`, `connection`, `auth` and `WAMediaUpload`. A Baileys major would then be our breaking change. Recommendation: type the native values as opaque, expose the socket through a single `@experimental` accessor, and drop or deprecate `connection` and `auth`.
- Move the low-level mappers (`toInbound`, `toOutbound`, `classifyDisconnect`, `backoffDelay`, the session path helpers, `makeSticker`, `transcodeToOpus`) to `/internal`. Trim the JID helpers to `toJid`, `normalizeJid`, `isPn`, `isLid` and `isGroup`, and make `toJid` throw on input without digits.
- Turn `reconnect?: boolean` into `boolean | { maxAttempts, baseMs, capMs }`. Deprecate `debug` in favour of `logger`. Rename `pairingCode` to `pairingPhoneNumber` (with an alias). `QrConfig.file: true` should require an explicit path, because the file is an account-access secret. Export only the `RateLimiter` config types. State that `MediaSource { native }` is unsupported on this transport.

### @botmesh/meta (`0.2.0-alpha.0`)

**Verdict: ready for beta.** 13 fixes in the meta-graph area, which also covers
graph-core and http. Tests: 194 passed. Main entry: 67 exports.

**Open defects**

- MEDIUM: the default `apiVersion` is `'v21.0'` (October 2024). Meta retires Graph versions about two years after release, so it is at or near retirement now. Recommendation: move to a current version during beta, checked against Meta's schedule, and document a version support policy.
- LOW:
  - An unknown `interactive.type` (for example `call_permission_reply`) is emitted as a `button` interaction with empty data.
  - Interactive limits are only partly enforced locally (an empty button list, more than 10 list rows, duplicate titles).
  - `cut()` works on code points, not graphemes.
  - Status `errors[0]` fields are passed through unchecked.
  - The new 60 s default timeout also covers media uploads of up to 100 MB.
  - A numeric `phoneNumberId` now throws.
  - The core `OutsideSessionWindowError` default message embeds the chat id.

**API freeze**

- Deprecate `GraphClient`, `GraphClientConfig` and `toProviderError` (it duplicates graph-core) and move them to `/internal`. Remove the already deprecated `GraphErrorBody`.
- Stop re-exporting `verifyChallenge`/`verifySignature`: there are three ways to verify today.
- `toFlowJson`/`publishForm` default to `lang: 'es'`. Recommendation: default to `en`.
- Mark the `SessionWindowManager` plumbing (`send(..., rawSend)`, `noteInbound`, `noteFailedStatus`) `@internal`.
- Drop `debug` in favour of `logger`, and replace `mediaDownload: Omit<SecureFetchOptions,'fetch'>` with a narrowed `MediaDownloadOptions`.
- Label `parseInbound`, `toOutbound` and the `Graph*` webhook types "low level, may change with Graph versions".
- `deleteMessage()` and `typing()` are silent no-ops. Recommendation: reject with `UnsupportedContentError`, or rely on the capability flags and document that the same way for every provider.

### @botmesh/telegram (`0.2.0-alpha.0`)

**Verdict: ready for beta.** 11 fixes. Tests: 140 passed. Main entry: 23 exports.

**Open defects**

- MEDIUM (core): long texts are not chunked (see core).
- LOW:
  - `callback_data` is cut to 64 bytes, so a longer button id never matches (documented).
  - In webhook mode, `ingest()` keeps emitting after `stop()`.
  - A webhook `start()` that races `stop()` can still emit `'ready'`.
  - `draftStops` can grow within its 10-minute TTL.
  - A command in a media caption (`/menu@Bot`) keeps the mention.
  - A 429 `retry_after` is not clamped (a huge value overflows `setTimeout`).
  - The new 120 s `requestTimeoutMs` is a total deadline that also covers uploads.
- Feature gaps, not bugs: inline queries, poll answers, reactions, channel posts and business messages; `parse_mode`/entities; `sendMediaGroup`/`sendAnimation`. There is also no live test against a self-hosted Bot API server.

**API freeze**

- Mark `toOutbound`, `MEDIA_UPLOAD`, `ResolvedTelegramMedia`, `TelegramOutbound` and `parseUpdate` `@experimental` or move them to a subpath. Change `parseUpdate` to take an options object.
- `pollTimeout` is in seconds while every other timing is in ms. Recommendation: add `pollTimeoutMs` and deprecate the old name.
- Deprecate `debug`. Consider `mode: 'polling' | 'webhook'` in place of three switches. Make `capabilities` `Readonly`. Document the wire types as "subset, may gain fields".
- New in this campaign; confirm before freezing: `requestTimeoutMs`, `username` and `TelegramWebhookHeaders`.

### @botmesh/sqlite-store (`0.2.0-alpha.0`)

**Verdict: ready for beta.** It shares 6 fixes with redis-store in the stores-public area.
Tests: 172 passed. Main entry: 8 exports.

**Open defects**

- LOW: a lone surrogate in a message id or cursor value becomes U+FFFD in storage, so two such ids could collide. This is theoretical.
- LOW (reviewer): `schedules()`/`durability()` do not check that the database is open.

**API freeze**

- `SCHEDULES_SCHEMA`/`DURABLE_SCHEMA` are exported, and there is no schema versioning (no `PRAGMA user_version`). Recommendation: add `user_version` migrations before stable and stop exporting the DDL.
- `logger` is `{ error? }`, while redis-store's is `{ error?, warn? }`. Recommendation: align both on the core `LoggerLike`.
- There is no `busyTimeout` option, yet the README promises safe multi-process use. Recommendation: expose the option.

### @botmesh/redis-store (`0.2.0-alpha.0`)

**Verdict: ready for beta.** Tests: 1,040 passed and 11 skipped, against a real Redis
and a real Redis Cluster with chaos enabled. Main entry: 34 exports.

**Open defects**

- LOW:
  - A store that owns its client fails before `start()` with node-redis' bare `The client is closed`.
  - `saveMessage` with `maxMessagesPerChat` costs 3 to 4 round trips, and the legacy layout reads windows with N `GET`s.
  - `MemoryStore` keeps a re-saved message at its first position, while the persistent stores order by timestamp. Recommendation: document this in `IStore`.

**API freeze**

- `redis@^4` is a hard dependency, and `NativeRedisClient` types are v4 `ReturnType`s. Recommendation: make it a peer with `^4 || ^5` and test both, or expose only `RedisLikeClient`.
- The cluster key-layout internals (`INDEX_BUCKETS`, `LAYOUT_MARKER`, `bucketOf`, `hashSlot`, `withClusterRetry`…) are exported. Recommendation: move them to `/cluster` or `/internal`.
- `RedisLikeClient`/`RedisMulti` are structural injection contracts, so every new command is a breaking change for custom clients. Recommendation: document them as "node-redis or our fakes only".
- The deprecated `ttl` and `acquireLock` options are still present. Recommendation: remove them before 1.0. The default prefix `'botwa'` is permanent unless it changes now.

### @botmesh/http (`0.2.0-alpha.0`) and @botmesh/graph-core (`0.2.0-alpha.0`)

**Verdict: ready for beta.** Tests: http 49, graph-core 61. Main entries: 12 and 18
exports.

**Open defects**

- LOW: `isPrivateIpv6` does not cover `::ffff:0:0:0/96` (RFC 2765).
- LOW: a timeout after a non-2xx status reports `HTTP 500` rather than a timeout error.
- Retry-After is now capped at 24 h and parsed strictly.

**API freeze**

- `SecureFetchOptions extends RequestInit` lets options such as `dispatcher` and `redirect` through, where they are silently overridden. Recommendation: list the supported fields.
- `resolvePublicHost` resolves a host without checking that it is public. Recommendation: rename it to `resolveHost` and keep an alias.
- `checkGraphSignature(body, headers, appSecret, logger)` takes four positional arguments. Recommendation: switch to an options object.
- graph-core is documented as an internal package, yet it is published. Recommendation: decide whether semver covers it.

### create-botmesh (`0.2.0-alpha.0`)

**Verdict: ready for beta.** 8 fixes in the onboarding area. Tests: 104 passed.

**Open defects**

- MEDIUM: the AI peer ranges were widened in this campaign to `^0.68 || ^1`, `^6.48 || ^7` and `0.21`–`0.24`. Streaming and tools were not verified on the new SDK majors (the basic call path was).
- LOW:
  - The templates are JS only, and `checkJs` reports errors in five templates.
  - The "Next steps" `cp .env.example .env` does not work in `cmd.exe`.
  - Node older than 22.9 fails with Node's own `bad option: --env-file-if-exists`.

**API freeze**

- `TEMPLATES` (a mutable record), `agentsMd` and `findBotMeshMonorepo` are public. Recommendation: keep `scaffold`, `TEMPLATE_NAMES`, `getTemplate` and the types public, and mark the rest `@internal`.
- `slashCommandsPlugin({ greeting })` replaces the whole `/help` text. Recommendation: add a `help` option and make `greeting` a prefix.
- There are two i18n entry points (`BotConfig.i18n` and `bot.locale()`). Recommendation: freeze one as the primary and document the other as sugar.

## Private packages

None of these is a candidate for promotion yet. To promote one, remove `"private"`,
switch its `workspace:*` dependencies to `workspace:^` (they now pin `@botmesh/core`
exactly), add a changeset and add a README section. Webhook channels other than Twilio
have not been confirmed against the real platform.

| Area | Packages | Verdict | Main open items |
| --- | --- | --- | --- |
| stores-private | postgres-store, mysql-store, mongo-store | ready for beta (as private) | In mysql and mongo, `deleteChat` is not atomic. Lone surrogate and U+0000 handling differs per store. The connection, prefix and logger option names differ per store. Driver types leak into the API. Only Postgres (and Redis) have a durability backend. List methods are unpaginated. |
| channels-a | discord, messenger, instagram, evolution, wppconnect | ready for beta | Discord interactions are now auto-acknowledged by the core (fixed on `sr/sandbox`); the Discord interaction token is embedded in `interactionId`. Text is not split. Discord, Messenger and Instagram use the global `fetch` with no timeout. Long button lists are truncated silently. WPPConnect live webhook delivery is not confirmed. |
| channels-b | twilio, gupshup, gohighlevel, email, tiktok | ready for beta | Webhooks have no timestamp, so signed requests can be replayed (dedupe by id is the only mitigation). The Gupshup list label is hardcoded to `Opciones`. A local media path fails with a raw `ENOENT`. Ingest contracts and error-mapper names are inconsistent. The two email ReDoS issues (HIGH and MEDIUM from review) were fixed before the merge. |
| platform | manager, flow-schema, server, mcp, wa-gateway-kit | ready for beta | `putFlow` does not recompile the flows that use it as a subflow. `createRestApi` has no body-read timeout (slowloris). Flows go live before they are persisted. Control-plane key matching leaks timing. manager has three overlapping HTTP APIs. flow-schema depends at runtime on deployments. |
| product | inbox, crm, hub, campaigns, deployments, tenant-kv | ready for beta | Listings have no cursors (notes, versions). The deployments version array grows without limit. There is no delete or erase, so GDPR erasure is impossible through the API. `attachInbox` defaults to tenant `'local'`. The manifest field is still named `botwa`. |
| plugins | nlu, dialogflow, chatwoot, tickets, moderation, rag, voice, events, otel | ready for beta | MEDIUM: `TicketDesk` ids collide across replicas. Moderation and chatwoot keep in-memory maps that only grow. Chatwoot accepts HMAC signatures without a timestamp (replayable). rag can lose a document on an embedder dimension change. The plugins depend on core through `workspace:*`, so a clean install gets two copies of core. The otel metric names use the `botwa.*` prefix. |
| tooling | eslint-plugin-botmesh (mcp is covered under platform) | not reviewed in this campaign | Its 92 tests pass. It has no area verdict. |

## Cross-cutting decisions

These affect several packages and must be settled once, in core first.

1. **Text chunking** to `maxTextLength`, in the core outbound path, with a unit field (or `maxTextBytes`) for Instagram's byte limit.
2. **`ctx.timestamp` unit**: epoch ms, converted in every provider.
3. **Default language** of built-in texts (core, meta Flows, moderation, Gupshup): English or an explicit choice.
4. **`debug` vs `logger`**: deprecate `debug` in every provider. Accept the core `LoggerLike` in every store.
5. **Silent no-ops vs rejections** for unsupported operations (`typing`, `deleteMessage`, `markRead`). Choose one rule, tied to `capabilities`.
6. **Subpath policy**: move wire mappers and engine internals to `/internal` (no semver promise), test doubles to `/testing`, and backend SPI to `/spi`, in every public package.
7. **Old names**: decide whether to rename the `botwa` prefixes, the metric names, the events channel, the manifest field and the `BOTWA_TEST_*` variables, with a migration, or to document them as permanent.
8. **Upstream pins**: Baileys RC, `@google/generative-ai`, `redis@^4` and the Graph `v21.0` default.

## Exit checklist

### Before `pre enter beta`

- [x] All 14 areas report *ready for beta*, and each was confirmed by a reviewer.
- [x] `pnpm build && pnpm typecheck && pnpm test` pass on the merged `main` (6,664 tests).
- [x] Every real-server suite passes with all the `BOTWA_TEST_*` server variables set (7,673 tests).
- [x] `pnpm api-check`, `pnpm pack:smoke`, `pnpm test:scripts`, `pnpm bench:soak`, `pnpm run docs` and `pnpm docs:check` pass.
- [x] `pnpm changeset status --verbose` works: the archived changesets were renamed.
- [ ] The maintainer reviews `pnpm changeset status --verbose` and `pnpm changeset publish-plan`.
- [ ] Optional, for a stronger signal: one `pnpm test` run on a quiet machine on Node 22 and on Node 24 (CI runs both), and the Ollama live smoke test.

### During beta (last window for breaking changes)

- [ ] Settle the [cross-cutting decisions](#cross-cutting-decisions). Each breaking change gets a changeset, a CHANGELOG entry and EN/ES docs.
- [ ] Trim the main entries (core, ai, baileys, meta, telegram, redis-store, create-botmesh) and remove the `@deprecated` re-exports of `@botmesh/core/internal`.
- [ ] Fix or document the MEDIUM items: text chunking, the first-`ask` checkpoint, the `ctx.timestamp` unit, `selfId` TS2420, the Meta `apiVersion`, the Baileys RC and ffmpeg, and the AI SDK majors verified with streaming and tools.
- [ ] Align the option naming: `retries`/`maxAttempts`, `*Ms` durations, `pollTimeout`, `pairingCode`, `journal` and `storeConfig`.
- [ ] Add schema versioning to sqlite-store, and decide on redis as a peer dependency (`^4 || ^5`).
- [ ] Stop adding features to the public packages; accept only fixes and decisions from this list.

### Before stable (`pre exit`)

- [ ] No open HIGH or MEDIUM defect in any public package.
- [ ] Every item of "During beta" is either done or documented as a permanent decision.
- [ ] At least one beta has been used for a few weeks by a real bot on Baileys, the Cloud API and Telegram, with no new MEDIUM defect.
- [ ] Version policy chosen. The 0.x packages go to `1.0.0` (a `major` changeset for each of ai, baileys, meta, telegram, sqlite-store, redis-store, http, graph-core and create-botmesh), or they stay 0.x with that choice documented. Core goes to `2.0.0`.
- [ ] Review the archived changesets in `.changeset/pre/`. `changeset pre exit` moves them back, and they become the changelog of the stable versions: keep only the notes that matter for stable.
- [ ] `create-botmesh` stamps caret ranges without a prerelease tag (this is regenerated by `version-packages`).

### Maintainer commands (not run by this campaign)

Run them in `main`, on a clean tree, after the checks above. Publishing to npm cannot
be undone.

From alpha to beta. Changesets v3 refuses `pre enter` while in pre mode, so leave
alpha first:

```bash
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

After the first stable publish, check `npm dist-tag ls @botmesh/core` (and the same
for the other packages): `latest` should point to the stable version. Keep `alpha` and
`beta` on their last prerelease, or remove them with `npm dist-tag rm`.
