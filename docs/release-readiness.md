# Release readiness: the beta with 36 public packages

> **Published (2026-10-27).** All 36 public packages are on npm under the `beta` dist-tag, at the
> versions in the [release plan](#release-plan) (`@botmesh/core` `2.0.0-beta.4`; the rest
> `1.0.0-beta.0` to `1.0.0-beta.2`). `latest` was moved by hand to the same versions for every
> package, and the release tags were pushed. The rest of this report is the pre-publish
> go/no-go and is kept as written.

Go/no-go report for the next publish of `@botmesh/*`: the first beta that ships all **36 public
packages** (the 10 already on npm under `alpha` plus the 26 promoted during the beta, which have
never been published), and the outlook for the later stable release (`pre exit`).

Date: 2026-10-26. Base: `main` after the per-package release tests (`merge: test <key>`, 26
packages) and the docs content review (`merge: docs review <key>`, 9 branches), plus this
report. Nothing was published or pushed. All numbers below come from that tree, on Windows 11
with pnpm 11.9.0 and Node 24.13.0 unless the row says Node 22.

## Verdict

| Step | Decision | Why |
| --- | --- | --- |
| **Publish the beta (36 packages)** | **GO** | Every check is green on the merged `main`: build, typecheck and 8,461 unit tests on Node 24 and Node 22; 9,517 tests with every real-server suite (Postgres, MySQL, Mongo, Redis, Redis Cluster with chaos, GreenMail, and the Docker suites for Evolution, WPPConnect, Chatwoot and Mailpit); `api-check`, `pack:smoke`, `test:scripts`, `bench:soak`, both docs builds and `docs:check`. No HIGH defect is open in any public package. **`pnpm version-packages` must run before `pnpm release`** (see [Maintainer release steps](#maintainer-release-steps)): without it the 26 new packages would go out as `0.1.0`. |
| **Stable (`pre exit`), the 10 original packages** | **GO after this beta**, with real use | API frozen in the earlier rounds; what is left is a few weeks of a real bot on the beta (Baileys, Cloud API, Telegram). |
| **Stable, the 26 promoted packages** | **NO-GO yet** | Their beta period starts with this publish. Several have only run against fakes or simulators (see [Live verification](#live-verification)); each needs its live check, and the [API-freeze notes](#api-freeze-notes) need a decision, before `pre exit`. A package that misses its live check stays on a prerelease instead of shipping 1.0.0. |

## Release plan

`pnpm changeset status --verbose` (49 pending changesets) and `pnpm changeset publish-plan`.
Pre mode `beta`, so every package is published under the `beta` dist-tag.

`publish-plan` reads the **current** `package.json` versions, so before `version-packages` it
lists the 26 promoted packages at `0.1.0` (and core at `2.0.0-beta.3`, meta/telegram/graph-core/
create-botmesh at `1.0.0-beta.1`). The versions that will actually be published are the ones
`changeset status` plans, after `pnpm version-packages`:

| Package | Version to publish | Bump | dist-tag |
| --- | --- | --- | --- |
| `@botmesh/core` | `2.0.0-beta.4` | minor | `beta` |
| `@botmesh/ai` | `1.0.0-beta.1` | none pending (versioned, unpublished) | `beta` |
| `@botmesh/baileys` | `1.0.0-beta.1` | none pending (versioned, unpublished) | `beta` |
| `@botmesh/http` | `1.0.0-beta.1` | none pending (versioned, unpublished) | `beta` |
| `@botmesh/redis-store` | `1.0.0-beta.1` | none pending (versioned, unpublished) | `beta` |
| `@botmesh/sqlite-store` | `1.0.0-beta.1` | none pending (versioned, unpublished) | `beta` |
| `@botmesh/meta` | `1.0.0-beta.2` | patch | `beta` |
| `@botmesh/telegram` | `1.0.0-beta.2` | patch | `beta` |
| `@botmesh/graph-core` | `1.0.0-beta.2` | patch | `beta` |
| `create-botmesh` | `1.0.0-beta.2` | patch | `beta` |
| `@botmesh/messenger` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/instagram` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/wa-gateway-kit` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/evolution` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/wppconnect` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/discord` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/twilio` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/gupshup` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/email` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/gohighlevel` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/postgres-store` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/mysql-store` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/mongo-store` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/server` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/events` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/otel` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/rag` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/voice` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/nlu` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/dialogflow` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/chatwoot` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/tickets` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/moderation` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/flow-schema` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `@botmesh/mcp` | `1.0.0-beta.0` | major (first publish) | `beta` |
| `eslint-plugin-botmesh` | `1.0.0-beta.0` | major (first publish) | `beta` |

`publish-plan` found none of these versions in the registry ("0 packages are already published"),
so all 36 will be published. `create-botmesh/src/versions.ts` stamps `^0.1.0` for the 26 promoted
packages until `version-packages` regenerates it; `pnpm release` runs `clean` + `build` after
versioning, so the published scaffolder stamps the right ranges.

## Maintainer release steps

Done on 2026-10-27 (kept for reference). Run in `main`, on a clean tree. Publishing to npm
cannot be undone.

```bash
git push                                   # the merged main (docs review, per-package fixes, this report)

pnpm changeset status --verbose            # expect the versions in the release plan above
pnpm version-packages                      # changeset version + create-botmesh versions.ts (REQUIRED: else the 26 new packages publish as 0.1.0)
git add -A && git commit -m "chore(release): version packages for the beta"
pnpm changeset publish-plan                # now lists the versions of the table above, all with (beta)
pnpm pack:smoke                            # optional re-check on the versioned tree
pnpm release                               # clean + build + changeset publish (dist-tag beta, creates the tags)
git push --follow-tags

# npm's `latest` still points at the first alpha of the 10 original names (and, for the 26 new
# names, at whatever npm sets on the first publish). Point it at this beta for every package:
npm dist-tag add @botmesh/core@2.0.0-beta.4 latest
npm dist-tag add @botmesh/ai@1.0.0-beta.1 latest
npm dist-tag add @botmesh/baileys@1.0.0-beta.1 latest
npm dist-tag add @botmesh/http@1.0.0-beta.1 latest
npm dist-tag add @botmesh/redis-store@1.0.0-beta.1 latest
npm dist-tag add @botmesh/sqlite-store@1.0.0-beta.1 latest
npm dist-tag add @botmesh/meta@1.0.0-beta.2 latest
npm dist-tag add @botmesh/telegram@1.0.0-beta.2 latest
npm dist-tag add @botmesh/graph-core@1.0.0-beta.2 latest
npm dist-tag add create-botmesh@1.0.0-beta.2 latest
npm dist-tag add @botmesh/messenger@1.0.0-beta.0 latest
npm dist-tag add @botmesh/instagram@1.0.0-beta.0 latest
npm dist-tag add @botmesh/wa-gateway-kit@1.0.0-beta.0 latest
npm dist-tag add @botmesh/evolution@1.0.0-beta.0 latest
npm dist-tag add @botmesh/wppconnect@1.0.0-beta.0 latest
npm dist-tag add @botmesh/discord@1.0.0-beta.0 latest
npm dist-tag add @botmesh/twilio@1.0.0-beta.0 latest
npm dist-tag add @botmesh/gupshup@1.0.0-beta.0 latest
npm dist-tag add @botmesh/email@1.0.0-beta.0 latest
npm dist-tag add @botmesh/gohighlevel@1.0.0-beta.0 latest
npm dist-tag add @botmesh/postgres-store@1.0.0-beta.0 latest
npm dist-tag add @botmesh/mysql-store@1.0.0-beta.0 latest
npm dist-tag add @botmesh/mongo-store@1.0.0-beta.0 latest
npm dist-tag add @botmesh/server@1.0.0-beta.0 latest
npm dist-tag add @botmesh/events@1.0.0-beta.0 latest
npm dist-tag add @botmesh/otel@1.0.0-beta.0 latest
npm dist-tag add @botmesh/rag@1.0.0-beta.0 latest
npm dist-tag add @botmesh/voice@1.0.0-beta.0 latest
npm dist-tag add @botmesh/nlu@1.0.0-beta.0 latest
npm dist-tag add @botmesh/dialogflow@1.0.0-beta.0 latest
npm dist-tag add @botmesh/chatwoot@1.0.0-beta.0 latest
npm dist-tag add @botmesh/tickets@1.0.0-beta.0 latest
npm dist-tag add @botmesh/moderation@1.0.0-beta.0 latest
npm dist-tag add @botmesh/flow-schema@1.0.0-beta.0 latest
npm dist-tag add @botmesh/mcp@1.0.0-beta.0 latest
npm dist-tag add eslint-plugin-botmesh@1.0.0-beta.0 latest

pnpm docs:deploy                           # GitHub Pages (gh-pages branch); try --dry-run first
```

If `changeset status` shows other versions than the table (for example after more changesets
land), use the versions from `pnpm changeset publish-plan` run **after** `version-packages` in
the `dist-tag` commands. Afterwards, `npm dist-tag ls @botmesh/core` should show `alpha`,
`beta` and `latest`; the `install with @alpha` notes in `AGENTS.md` and the README can then say
`@beta` or drop the tag.

## Per-package verdicts

"Beta" is the verdict for this publish; "stable" is the outlook for `pre exit`. Main entry =
runtime and type names exported from `.` (`node scripts/api-check.cjs surface`); `(n dep.)` =
names tagged `@deprecated`.

### The 10 original packages (on npm under `alpha`)

| Package | Beta | Stable | Main entry (other entries) | Notes |
| --- | --- | --- | --- | --- |
| `@botmesh/core` | GO | GO after this beta | 372 (31 dep.); `/internal` 79, `/spi` 95, `/testing` 118, `/testing/vitest` 6, `/dev` 52 | New in this beta: `/spi` flow-interpreter hooks (`pauseControls`, `runFormStep`), `bot.plug(plugin, config)` typed by the plugin, `/testing` doubles that compile under `exactOptionalPropertyTypes`. Open LOWs below. |
| `@botmesh/ai` | GO | GO after this beta | 98 (3 dep.); `/internal` 39, `/testing` 5 | Kimi default model unconfirmed (outside semver). |
| `@botmesh/baileys` | GO | GO after this beta (rc pin accepted) | 56 (34 dep.); `/internal` 58 | Upstream still `7.0.0-rc14`; pin and upgrade policy in the README. |
| `@botmesh/meta` | GO | GO after this beta | 67 (5 dep.) | `ingest()` now answers 503 while the bot is stopped (was 200, so the webhook was lost). Typing indicator not implemented. |
| `@botmesh/telegram` | GO | GO after this beta | 27 (1 dep.) | Poll-vote tracker in memory only. |
| `@botmesh/sqlite-store` | GO | GO after this beta | 10 (2 dep.) | |
| `@botmesh/redis-store` | GO | GO after this beta | 34 (5 dep.); `/internal` 17 | Real single-node and Cluster suites (chaos on) green with node-redis 4, 5 and 6. |
| `@botmesh/http` | GO | GO after this beta | 14 (4 dep.) | |
| `@botmesh/graph-core` | GO | GO after this beta | 24 (1 dep.) | |
| `create-botmesh` | GO | GO after this beta | 13 (4 dep.); `/internal` 4 | `--help` now names the dist-tag of the running version (`npm create botmesh@beta`). |

### The 26 promoted packages (first publish, `1.0.0-beta.0`)

| Package | Beta | Stable | Main entry (other entries) | Release test (this campaign) and what is left |
| --- | --- | --- | --- | --- |
| `@botmesh/messenger` | GO | after a live test | 10; `/internal` 3 | Fixed: button text over 640 chars, list text dropped, card/list text over 2,000 chars, message tags through `platformData`, `message_edits`, multi-attachment messages, shared links, grapheme-safe labels, 503 while stopped. Left: guessed inbound mimetypes, multi-part sends can be half sent. |
| `@botmesh/instagram` | GO | after a live test | 13; `/internal` 6 | Fixed: captions and card images dropped (card text now first, image second), multi-photo DMs, 503 while stopped, config validation, quick-reply rules, `selfId`. Left: `message_edit`, read/delivery and referral webhooks ignored; 200 before the first `start()`. |
| `@botmesh/wa-gateway-kit` | GO | after the persistence decision | 17 | Fixed: `{ url }` is link-only (no local file reads), credential masking, quadratic `normalizeJid`, config validation, RFC 9110 `Retry-After`. Left: synchronous `IdentityPersistence` (MEDIUM design), positional `WaIdentityStore` constructor. |
| `@botmesh/evolution` | GO | after a paired-number test | 10; `/internal` 14 | Fixed against a real Evolution v2.3.4: `refused` pairing, `fromMe` default on delete, poll limits, "not connected" errors (including logged-out `Connection Closed`). Left: LID-only DMs from upstream (MEDIUM), no paired-number round trip (MEDIUM). |
| `@botmesh/wppconnect` | GO | after a paired-number test | 9; `/internal` 12 | Fixed against a real server-cli 1.3.50: false ready on `inChat`, `disconnectedMobile`/`phoneNotConnected`, LID lookups on every message and after cache eviction, secret redaction, bounded HTML error parsing. Left: no paired-number round trip; `ingest()` returns a promise. |
| `@botmesh/discord` | GO | after a live test | 11; `/internal` 25 | Fixed (HIGH, security): REST path injection through ids, missing `allowed_mentions` (mass pings from echoed text); overlapping gateways after `start()`/`stop()`. Left: poll votes, type-5 defer replacement on a real server. |
| `@botmesh/twilio` | GO | after a live test | 14; `/internal` 10 | Fixed: prototype-named webhook params, `webhookPath` query, credential checks. Left: typing indicator uses a public-beta endpoint; replay window. |
| `@botmesh/gupshup` | GO | after a live test | 12; `/internal` 6 | Fixed: token in the ingress URL, raw base64 tokens, labels cut to limits. Left: v1 send API to confirm with a live account; shared-token auth with a replay window. |
| `@botmesh/email` | GO | after a live test | 28 (1 dep.); `/internal` 16 | Fixed: hostile headers, real-world mimetypes, legacy Message-IDs, actionable connection errors. Real GreenMail and Mailpit suites pass; no real mail provider yet. |
| `@botmesh/gohighlevel` | GO | after a live test | 13; `/internal` 8 | Fixed: prototype-named entities/channels leaking source text, email HTML bodies, token validation. Left: inbound media typed `application/octet-stream`; replay window. |
| `@botmesh/postgres-store` | GO | GO after one beta | 11 | Fixed: long `tablePrefix`, stop during start, injected pools after `stop()`, lone-surrogate ids. Real PostgreSQL 16 suite green. |
| `@botmesh/mysql-store` | GO | GO after one beta | 9 | Fixed: password leaks from malformed URIs, oversized statements poisoning the pool, prefix limits, unreachable-server errors. Real MySQL 8.4 suite green (MariaDB 11 in the release test). |
| `@botmesh/mongo-store` | GO | GO after one beta | 12 | Fixed: arrays under prototype-named keys read back as raw BSON. Real Mongo 7 suite green with drivers 7 and 6. |
| `@botmesh/server` | GO | GO after one beta | 28; `/express` 3, `/fastify` 5, `/hono` 3, `/internal` 2 | Fixed: invalid `ingest()` statuses, `/readyz` when the state throws, result headers casing and framing headers. |
| `@botmesh/events` | GO | GO after one beta | 32; `/durability` 4 | Fixed: non-JSON envelopes and invalid records poisoning file journals. The shared-journal "concurrent claimers" tests passed in every run of this round (they timed out on a loaded machine before). |
| `@botmesh/otel` | GO | GO after one beta | 12; `/internal` 2 | Fixed: histogram buckets in seconds, mixed clocks in span durations, `dropped.echo` reported. |
| `@botmesh/rag` | GO | after a live embedder call | 41; `/internal` 8 | Fixed: cubic heading parser, embedder switch, persistence errors. OpenAI and Ollama embedders only run against fakes. |
| `@botmesh/voice` | GO | after live STT/TTS calls | 41; `/internal` 8 | Fixed: OGG duration sniffed from bytes (cost cap bypass), per-call timeouts, limits validation. OpenAI, Deepgram and ElevenLabs only run against fakes. |
| `@botmesh/nlu` | GO | GO after one beta | 8 | Fixed: confidence over 1, repeated input words, normalization across scripts. |
| `@botmesh/dialogflow` | GO | after a live ES and CX call | 21 (1 dep.); `/internal` 7 | Fixed: per-participant sessions in groups, config errors, 401 retry, text cap. Left: the never-published `dialogflowContext` alias is still exported as `@deprecated`. Google OAuth and `detectIntent` only run against fakes. |
| `@botmesh/chatwoot` | GO | GO after one beta | 22; `/internal` 5 | Fixed against a real Chatwoot 4.7: exact contact lookup, re-linking lost mappings, deleted conversations. Real round-trip suite green. |
| `@botmesh/tickets` | GO | GO after one beta | 28; `/internal` 2 | Fixed: input validation and corrupt-storage errors. Left: `list()` with closed tickets scans every id. |
| `@botmesh/moderation` | GO | GO after one beta | 23; `/internal` 6 | Fixed: formatted invites, config validation, throwing `isAdmin`. Left: `kick` degrades to `mute` (no groups capability yet; `GroupAdminApi` is `@experimental`); state in memory. |
| `@botmesh/flow-schema` | GO | GO after one beta | 44; `/internal` 16 | Fixed: media URLs from `c.state` (local paths, private hosts, plain http), `http` step hardening, validator matches the JSON schema (differential fuzz against ajv). |
| `@botmesh/mcp` | GO | GO after one beta | 21; `/internal` 29 | Fixed: tool input schemas enforced, EPIPE handling, bounded lines. Not yet driven by a real MCP client from the packed tarball. |
| `eslint-plugin-botmesh` | GO | GO after one beta | 8 (2 dep.) | Rules aligned with the real API (`choose`/`waitAny` timeouts, `flow([])`, read-only lookups). |

## Open defects by severity

No **HIGH** defect is open in any public package. The two HIGH findings of this campaign
(Discord REST path injection and missing `allowed_mentions`) and the HIGH Messenger
button-template rejection are fixed and tested.

**MEDIUM** (none blocks the beta; each must be fixed or accepted before `pre exit`):

- `@botmesh/evolution`: Evolution v2.3.4 (Baileys `7.0.0-rc.3` inside) overwrites
  `key.remoteJid` with `remoteJidAlt`, so a DM that arrives without `remoteJidAlt` is LID-only
  and gets a different `senderId`. The provider never sees the LID/PN pair; a fix needs a lookup
  through the Evolution API, which cannot be checked without a paired number.
- `@botmesh/evolution`, `@botmesh/wppconnect`: no real round trip with a paired number (message,
  media download, `exists:false`, reactions/edits/deletes/read on real keys); those paths are
  covered by fixtures only.
- `@botmesh/wa-gateway-kit`: `IdentityPersistence` is synchronous, so it cannot be backed directly
  by Redis/Postgres/Mongo (preload or cache it). Async persistence after 1.0 would need a new
  interface: decide before stable.
- Live verification missing for the promoted channels and the paid-API plugins (see
  [Live verification](#live-verification)): a wrong request shape or auth header would ship
  as 1.0.

**LOW** (selected; full lists in the per-package `CHANGELOG [Unreleased]` sections and the
package READMEs):

- core: an edit replaces the content fingerprint the deduper keeps for its id, so a late
  redelivery of the original after an edit is processed again (Telegram and Messenger); edits
  reach an active conversation as answers (documented, `isEditedMessage()` filters them). The
  earlier core LOWs remain (`markRead` under coordination after `stop()` rejects, a re-split
  journaled part's order not pinned by a test, `@botmesh/ai` aborting on `'stopping'` before the
  drain, `ctx.edit` text not split).
- core ergonomics: scheduler callbacks (`bot.delay/every/schedule`) are typed
  `() => void | Promise<void>`, so `() => bot.resume(chatId)` (returns `Promise<boolean>`) does not
  type-check; `AIToolContext.ctx` is optional although autoreply always sets it.
- messenger/instagram: inbound mimetypes guessed from the attachment type; multi-part sends can be
  half sent and a durable retry repeats the first part; Instagram answers 200 before the first
  `start()`.
- messenger: invalid `platformData` throws a plain `TypeError` (the durable outbox retries it); a
  `tag` with an explicit `messaging_type` other than `MESSAGE_TAG` is posted as is.
- wa-gateway-kit: a throwing `IdentityPersistence` fails that webhook; inline media of about
  400 MB fails with Node's `ERR_STRING_TOO_LONG`; paths and streams are read fully into memory;
  malformed `data:` URIs produce empty media.
- evolution: poll votes and `messages.edited` are not delivered; the 401 warning is logged on
  every unauthenticated request; `saysNoSession` matches any "Cannot read properties of
  undefined" TypeError.
- wppconnect: one slow `pn-lid` lookup delays the next webhooks (up to `lidLookupTimeoutMs`);
  `start()` still treats a `status-session` of `inChat` as ready; numeric-string coordinates
  are rejected.
- webhooks of Twilio, Gupshup and HighLevel have a replay window (no signed timestamp; dedupe by
  id).
- `@botmesh/ai` tests: `tests/entry-layout.test.ts` can fail with `ENOENT` when a docs-example
  test creates and deletes `packages/ai/.docs-example-*` in parallel (it did not fail in this
  round); the upper-range SDK suite has no `@google/genai` case.
- `@botmesh/manager` (private): `POST /bots/{id}/trigger` maps every `triggerFlow` rejection to
  409.

Fixed while writing this report: VitePress rendered `docs/guide/flow-schema.md` (EN/ES) without
content because Vue interpolated the inline `{{ user.name }}`, and the inline templates in the
integrations guides rendered as empty code. They now use `<code v-pre>`, and `docs:check` fails on
any `{{ }}` outside a code fence or `<code v-pre>` (tests in `scripts/smoke/docs-check.test.mjs`).

## Live verification

What has run against the real service, and what only against fakes or simulators. "Fakes" means
injected `fetch`/sockets shaped after the public API docs; "simulator" means the
`@botmesh/sandbox` HTTP simulators (Twilio and Discord requests validated against vendored
official OpenAPI fragments).

| Package | Real service | Self-hosted real server (Docker) | Fakes / simulators only |
| --- | --- | --- | --- |
| `baileys` | Real WhatsApp login during the alpha (not repeated in this round) | | Unit tests and the identity suites |
| `meta` (Cloud API) | Real use during the alpha (not repeated in this round) | | Sandbox simulator |
| `telegram` | Real use during the alpha (not repeated in this round) | | Sandbox simulator |
| `messenger`, `instagram` | **Never** | | Fakes and the sandbox simulator |
| `evolution` | **Never with a paired number** | Evolution API v2.3.4: instance, QR and connection webhooks, `jwt_key` webhooks, typed errors | Message round trip, media, reactions/edits/deletes: fixtures only |
| `wppconnect` | **Never with a paired number** | server-cli 1.3.50: token, session start, QR, typed errors | Message round trip and live status transitions: mapped from source, fixtures only |
| `wa-gateway-kit` | via the two above | via the two above | |
| `discord`, `twilio`, `gupshup`, `gohighlevel` | **Never** | | Fakes and the sandbox simulator |
| `email` | **Never** with a real mail provider | GreenMail 2.1.3 (IMAP IDLE + SMTP) and Mailpit 1.27 (SMTP) | |
| `chatwoot` | | Chatwoot 4.7.0: full round trip, agent reply, handoff, resolve | |
| `dialogflow` | **Never** (Google OAuth JWT exchange, ES and CX `detectIntent`) | | Fakes |
| `voice` | **Never** (OpenAI, Deepgram, ElevenLabs) | | Fakes |
| `rag` | **Never** (OpenAI `/embeddings`, Ollama `/api/embed`) | | Fakes |
| `ai` | No paid API in this round; Ollama live suite exists (opt-in, not run this round) | | The real SDKs against local HTTP fakes, oldest and newest peer versions |
| stores (5), `events`, `server`, `otel` | | PostgreSQL 16, MySQL 8.4, Mongo 7, Redis 7, Redis Cluster 7.0.10 (chaos) | |
| `nlu`, `tickets`, `moderation`, `flow-schema`, `mcp`, `eslint-plugin`, `http`, `graph-core`, `create-botmesh` | n/a (no external service), `mcp` not driven by a real MCP client | | |

## API-freeze notes

To decide before `pre exit`; none blocks the beta. Most concern packages never published, where
a change is still cheap.

- **Positional error mappers.** `toMessengerError(err, retryAfterMs?, chatId)`,
  `toInstagramError(...)` and `toEvolutionError(status, body, chatId, retryAfterMs?)` take
  positional arguments while graph-core's `toGraphError` takes an options object. Mapper names
  are not uniform either (`toWppError`, `toGhlError`).
- **`debug` option.** The never-published channels ship the deprecated `debug` option ("removal in
  v3") only for consistency; it could be removed before 1.0.
- **Deprecated alias in a new package.** `@botmesh/dialogflow` exports the `@deprecated`
  `dialogflowContext`; it could be removed before its first publish instead.
- **Wire types on semver entries.** Messenger's `PageWebhookBody`, `MessagingEvent`,
  `MessengerMessage`, `MessengerAttachment`, and Instagram's `InstagramSendResponse` (which also
  carries an `error` field) are on the main entry, which freezes their shape.
- **wa-gateway-kit.** `WaIdentityStore(maxEntries, persistence)` is positional; the entry exports
  generic helpers (`isRecord`, `describeErrorBody`, `parseRetryAfter`) that become frozen;
  `IdentityPersistence` is synchronous (see MEDIUM).
- **`ingest()` return types** still differ (`Promise<number>` on WPPConnect because it waits for
  LID lookups); documented, not unified.
- **Multi-attachment ids** use `<mid>#<n>` on Messenger and Instagram but `MessageSid:i` on Twilio.
- **core scheduler callback type** (`() => void | Promise<void>` vs `() => unknown`) and
  `AIToolContext.ctx` optionality (see LOW).
- Earlier rounds' follow-ups still stand: entry-pin tests check runtime names only; no
  `/internal` import guard outside core; `@botmesh/ai` entries are not in TypeDoc.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Build | `pnpm build` | OK, 46 workspace projects (45 packages + the example) |
| Typecheck | `pnpm typecheck` | OK (src + tests, every package) |
| Unit tests, no servers (Node 24.13.0) | `pnpm test` | **8,461 passed**, 940 skipped (opt-in suites), 0 failed, 688 test files |
| Node 22 | `pnpm build && pnpm typecheck && pnpm test` with portable **Node v22.23.4** first on `PATH` | OK: build and typecheck green; **8,461 passed**, 940 skipped, 0 failed, 688 test files (same as Node 24) |
| Unit and real-server tests | `pnpm test` with every `BOTWA_TEST_*` variable below | **9,517 passed**, 19 skipped, 0 failed, 688 test files |
| redis-store, other clients | `BOTWA_TEST_REDIS_CLIENT=v4` / `v5`, same servers, chaos on | 1,051 passed / 11 skipped each (v6 in the full run: the same) |
| mongo-store, driver 6 | `BOTWA_TEST_MONGO_DRIVER=v6` | 263 passed |
| Script tests | `pnpm test:scripts` | 24/24 before this report's docs-check change, 26/26 after |
| Public API | `pnpm api-check` | OK: no missing exported types, no `any`, no `@internal`, no transport SDK or driver type reachable from a semver entry. Export totals over all entries in [Per-package verdicts](#per-package-verdicts). |
| Tarballs | `node scripts/pack-smoke.mjs` | OK for all **36** public packages (nothing published). Tarballs inspected (no `@internal`, no test files); a clean npm consumer type-checks (nodenext and bundler, `skipLibCheck` true and false) and runs a scenario across core, ai, the stores on injected pools, server, events, plugins, flow documents and MCP; `@botmesh/otel` imports without `@opentelemetry/api` and fails clearly on use; every entry imported from the tarballs (core `.`, `testing`, `testing/vitest`, `dev`, `spi`, `internal`; ai `.`, `testing`, `internal`; server `.`, `express`, `fastify`, `hono`, `internal`; the `internal` entries of the channels and plugins); the 10 `create-botmesh` templates install from a local registry and boot in `botmesh dev`. The 26 promoted packages pack at `0.1.0` until `version-packages`. |
| Release plan | `pnpm changeset status --verbose`, `pnpm changeset publish-plan` | OK: 49 pending changesets; see [Release plan](#release-plan) |
| Soak | `pnpm bench:soak` | 7 rounds of about 2,000 messages, 4,614 to 6,364 msg/s, p99 lag 41 to 77 ms, 0 errors, 600 tool runs. Heap 16.5 → 24.5 MB (946 KB/round), 21.9 MB after erasing the 700 fresh chats. Stop under load 10 ms, no conversations or active resources left. |
| Docs | `pnpm run docs`, `pnpm docs:check` (base `/`), `DOCS_BASE=/botmesh/ pnpm run docs`, `pnpm docs:check` | OK. TypeDoc: 0 warnings. `docs:check`: 0 errors, 0 warnings with base `/` and with base `/botmesh/` (after this report's `{{ }}` fix; before it, the flow-schema guide rendered empty). Vite still prints its advisory about chunks over 1 MB (not a docs warning). |
| Deploy dry run | `node scripts/docs-deploy.mjs --dry-run --force-branch` | OK: build with `DOCS_BASE=/botmesh/`, docs-check clean, a single `gh-pages` commit prepared in a temp repo (1,134 files, 35.4 MiB, `.nojekyll` present); nothing pushed, temp repo deleted. |

Per-package totals in the real-server run: core 2,446 (5 skipped), redis-store 1,051
(11 skipped), ai 495 (2 skipped: the Ollama live suite), postgres-store 375, mysql-store 351
(1 skipped, MariaDB-only), baileys 282, mongo-store 263, events 249, meta 234, sandbox 220 (all
Docker suites), sqlite-store 208, telegram 165, email 162 (GreenMail), discord 160, messenger 118,
twilio 108, instagram 106, voice 101, flow-schema 100, moderation 95, mcp 87, evolution 84, rag 77,
graph-core 77, wppconnect 75, server 73, wa-gateway-kit 71, gohighlevel 68, http 66, gupshup 63,
dialogflow 57, tickets 54, nlu 51, chatwoot 48, otel 31; private: hub 153, inbox 145, manager 144,
eslint-plugin 140, deployments 138, tiktok 132, create-botmesh 116, campaigns 108, crm 97,
bakery-ai 43, tenant-kv 30. No test was skipped or retried to get these results.

Servers (all on `127.0.0.1`, removed afterwards):

| Variables | Server |
| --- | --- |
| `BOTWA_TEST_POSTGRES_URL` | `postgres:16` |
| `BOTWA_TEST_MYSQL_URL` | `mysql:8.4` |
| `BOTWA_TEST_MONGO_URL` | `mongo:7` (standalone) |
| `BOTWA_TEST_REDIS_URL` | `redis:7` |
| `BOTWA_TEST_REDIS_CLUSTER_URL` + `BOTWA_TEST_REDIS_CLUSTER_CHAOS=1` | `grokzen/redis-cluster:7.0.10`, 3 masters + 3 replicas |
| `BOTWA_TEST_EMAIL` (+ host and ports) | `greenmail/standalone:2.1.3` |
| `BOTWA_TEST_EVOLUTION_*` | Evolution API `v2.3.4` (sandbox compose) |
| `BOTWA_TEST_WPPCONNECT_*` | WPPConnect server-cli `1.3.50` (sandbox compose) |
| `BOTWA_TEST_CHATWOOT_*` | Chatwoot `v4.7.0` (sandbox compose, token from `chatwoot-token.mjs`) |
| `BOTWA_TEST_MAILPIT_*` | Mailpit `v1.27` (sandbox compose) |
| `BOTWA_TEST_SDK_UPPER_DIR` | `@anthropic-ai/sdk` 1.3.0, `openai` 7.43.0, `@google/generative-ai` 0.24.1 in a scratch folder |

Not run in this round: the Ollama live suite (`BOTWA_TEST_OLLAMA_*`) and any paid AI or
messaging API.

## Integration of this round

The docs review branches were merged into `main` one at a time with `git merge --no-ff`
(`merge: docs review <key>`): `rd/start`, `rd/core`, `rd/channels`, `rd/ai`, `rd/data-prod`,
`rd/tooling`, `rd/reference-upgrade`, `rd/examples-a`, `rd/examples-b`.

- **Conflicts:** `CHANGELOG.md` in `channels`, `data-prod`, `tooling`, `reference-upgrade` and
  `examples-b` (every section kept). `rd/start` and `rd/tooling` both fixed the stale
  `npm create botmesh@alpha` in `create-botmesh --help` with two different `createCommand()`
  helpers; the merge keeps one implementation, the `rd/tooling` one (the tag comes from the
  CLI's own `package.json` version, which is what `npm create botmesh@<tag>` resolves), its test
  and its changeset.
- **Code fixed by the docs review** (each with tests): `@botmesh/meta` and `@botmesh/messenger`
  `ingest()` answer 503 while stopped; `@botmesh/otel` reports `dropped.echo`; `create-botmesh
  --help` dist-tag.
- **Cleanup:** the nine `rd/*` branches were deleted, `git worktree prune` was run, and the
  review folders in the scratch directory were removed. Only this round's containers
  (`ra-final-*` and the `ra-final-sb` compose project with its volumes and network) were
  removed.

## History

Earlier rounds, kept short; their full reports are in the git history of this file.

- **Alpha → beta and the stable-readiness campaign** (base `9bcba20` → `e148ea2`, then the
  closeout round and the API freeze round): the core entry layout (`/internal`, `/spi`,
  `/testing`), one canonical name per concept, behaviour decisions (English default,
  `retries`/`maxAttempts`, `BotNotRunningError`, long-text splitting, epoch-ms timestamps),
  the API freeze of `ai`, `baileys`, `http`, `graph-core`, `meta`, `redis-store`,
  `sqlite-store` and `create-botmesh`, and the stable line (core `2.0.0`, `1.0.0` for the
  rest). The migration guides (EN/ES) document every break.
- **Promotion rounds** (after the beta versioning commit `cda0ebe`): Messenger and Instagram;
  the WhatsApp REST gateways (`wa-gateway-kit`, `evolution`, `wppconnect`); five channels
  (`discord`, `twilio`, `gupshup`, `email`, `gohighlevel`); the stores (below);
  infrastructure (`server`, `events`, `otel`); seven plugins (`rag`, `voice`, `nlu`,
  `dialogflow`, `chatwoot`, `tickets`, `moderation`); tooling (`flow-schema`, `mcp`,
  `eslint-plugin-botmesh`). Each got an `/internal` entry where needed, frozen data, an
  entry-pin test, `api-check` and `pack:smoke` coverage and a changeset (`major` →
  `1.0.0-beta.0`).
- **Per-package release tests** (26 `merge: test <key>` commits): each promoted package was
  tested as a demanding user and as an attacker, fixed with TDD, and checked by a reviewer
  (see [Per-package verdicts](#per-package-verdicts)).

### Store promotion round

`@botmesh/postgres-store`, `@botmesh/mysql-store` and `@botmesh/mongo-store` became public
(changeset `stores-public.md`). `pg`, `mysql2` and `mongodb` are lazy-loaded peers; no driver
type is reachable from a `.d.ts` (`api-check` `SEMVER_FORBIDDEN_IMPORTS`); `logger:
Partial<LoggerLike>`; mysql `PoolLike`/`ConnectionLike` → `MysqlPoolLike`/`MysqlConnectionLike`,
mongo `ScheduleDoc` → `MongoScheduleDoc` (no aliases: never published). Main entries:
postgres-store 11, mysql-store 9, mongo-store 12.

## Exit checklist

### Before this publish

- [x] Docs review branches merged; `pnpm build && pnpm typecheck && pnpm test` green on Node 24
  and Node 22 (8,461 tests).
- [x] Every real-server suite and the sandbox Docker suites pass (9,517 tests); redis-store green
  on node-redis 4, 5 and 6; mongo-store on drivers 6 and 7.
- [x] `pnpm api-check`, `pack:smoke`, `test:scripts`, `bench:soak`, `pnpm run docs`,
  `docs:check` (both bases) and the deploy dry run pass.
- [x] Maintainer: `pnpm version-packages` and commit, then `pnpm release` and the `dist-tag`
  commands ([Maintainer release steps](#maintainer-release-steps)). Done on 2026-10-27: all 36
  published under `beta`, `latest` moved, tags pushed.

### During beta

- [ ] Decide the [API-freeze notes](#api-freeze-notes) for the 26 promoted packages (cheap now,
  semver-breaking after 1.0).
- [ ] Watch upstream Baileys for a stable 7.x (`latest` is still `7.0.0-rc14`).
- [ ] Accept only fixes and those decisions in the public packages.

### Before stable (`pre exit`)

- [ ] No open HIGH or MEDIUM defect in any public package (today: the Evolution LID-only DMs,
  the paired-number round trips and the `IdentityPersistence` decision).
- [ ] At least one beta used for a few weeks by a real bot on Baileys, the Cloud API and
  Telegram, with no new MEDIUM defect.
- [ ] One live test each for Messenger, Instagram, Discord, Twilio, Gupshup, email (real mail
  provider) and HighLevel; a paired-number round trip on Evolution and WPPConnect; Twilio
  typing-indicator decision (public-beta endpoint) and Gupshup v1 API confirmed.
- [ ] One real call of each plugin path that only ran against fakes: Dialogflow ES and CX
  (including the Google OAuth JWT exchange), voice STT/TTS on OpenAI, Deepgram and ElevenLabs,
  the rag embedders on OpenAI and Ollama. A package whose call was not run stays on a
  prerelease.
- [ ] Review the archived changesets in `.changeset/pre/`; `changeset pre exit` moves them back.
- [ ] `create-botmesh` stamps caret ranges without a prerelease tag (regenerated by
  `version-packages`).

From beta to stable (maintainer, later):

```bash
pnpm changeset pre exit
pnpm changeset status --verbose     # expect stable versions, published under latest
pnpm version-packages
git add -A && git commit -m "chore(release): version packages for the stable release"
pnpm pack:smoke
pnpm release
git push --follow-tags
```
