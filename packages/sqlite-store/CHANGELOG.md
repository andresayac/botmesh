# @botmesh/sqlite-store

## 1.0.0-beta.1

### Major Changes

- 79af076: First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).

### Minor Changes

- be1feac: Schema version 2 (`SQLITE_SCHEMA_VERSION`): the durable scheduler's tables (`schedules`, `schedule_fences`) and the durability table (`durable` and its partial indexes) are part of the versioned migrations and are created when the database is opened. They used to be created ad hoc, outside the schema version, the first time `schedules()` or `durability()` was called. Files at version 0 or 1 are upgraded in place, keeping the rows of tables that already existed. `SQLiteScheduleStore` and `SQLiteDurableKv` built on a bare connection still create their table if it is missing. Rollback: once this release opens a file, the previous alpha (schema version 1) refuses it with `SQLITE_SCHEMA_TOO_NEW`, even when the app never uses schedules or durability; stop processes on the old version before the new one opens a shared file, and restore a backup (or set `PRAGMA user_version = 1`, since the step only adds tables) to roll back.
- 7bccf89: Schema versioning: the database records its layout in `PRAGMA user_version` (`SQLITE_SCHEMA_VERSION`, now `1`) and opening it runs the pending migrations in order, each in its own `IMMEDIATE` transaction with the version bump. Files written by earlier releases (version `0`) are upgraded in place with every row kept. **Breaking:** a file written by a newer release is refused, untouched, with the new `SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`, `found`, `supported`). New `busyTimeoutMs` option (default 5000, `PRAGMA busy_timeout`); `logger` accepts any `LoggerLike` (every method optional). The exported `SCHEDULES_SCHEMA` and `DURABLE_SCHEMA` DDL strings are deprecated.
- 5dc00f7: - `saveMessage` and `setCursor` reject (`TypeError`) a message id, chat id, cursor key or cursor value that contains a lone UTF-16 surrogate. SQLite stores text as UTF-8, where such a character becomes U+FFFD, so two different ids could share one row (or a value came back changed). `getMessage`/`getCursor` with such a key find nothing.
  - `schedules()` and `durability()` on a stopped store reopen the database (and re-point the backends already handed out) instead of failing later with better-sqlite3's "The database connection is not open".
  
  What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).

### Patch Changes

- 54ebba3: README rework for the stable line: one structure (what it is, install, quick start, options, errors, links), a single note about the prerelease dist-tag instead of hard-coded `@alpha` commands, no stale "alpha/experimental" banners, English examples and canonical option names only. Fixes wrong samples: `secureFetch` resolves `{ url, response, body }` with the body already read (the old sample called `response.json()`), the Meta webhook sample keeps the raw body with `express.raw()` (no `any` casts), the Meta pricing sample was not valid TypeScript, and the Redis Cluster sample passes `rootNodes` as URL strings. Documents the previously missing exports (`assertSafeTarget`, `isAllowedHostUrl`, `isPrivateAddress`, `graphRequest`, `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`) and the errors users hit (pnpm build scripts, `better-sqlite3` on Node.js 24.19, Graph `190`/`100`/`131030`, Telegram `404`).
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
- ee49c56: Import the backend and transport helpers (`toInboundLocation`, `messageKey`, `KvDurability`, the schedule and form helpers, `I18n`) from the new `@botmesh/core/spi` subpath, so these packages need the `@botmesh/core` version that ships it. No behaviour change. The doc examples use `durability: { backend }` (`journal` is its deprecated name).
- 473728a: The "native module was never built" error names pnpm 11's `allowBuilds: { better-sqlite3: true }` in `pnpm-workspace.yaml` next to pnpm 10's `onlyBuiltDependencies`.
- 4487b43: Document that Node.js 24.19+ needs `better-sqlite3` 13: versions 11 and 12 can abort the process when a prepared statement is garbage-collected (nodejs/node#65446). The package is now tested against `better-sqlite3` 13.
  
  With `better-sqlite3` 13, a missing native binary (no prebuild for the platform and no build) is reported as "Cannot find module …/better_sqlite3.node"; `SQLiteStore` now turns it into the same actionable "native module was never built" error as with versions 11 and 12.
- a2c946a: The `better-sqlite3` peer range now covers `^11.7.0`, `^12.0.0` and `^13.0.0`; the store was run against 12.11.1 and 13.0.3 (chats, contacts, messages, checkpoints with compare-and-set, conversations, cursors, per-user data and persistence across instances) with the same results as 11.x. Installing the latest `better-sqlite3` no longer warns about an unmet peer. `./package.json` is exported again.
- df9b38f: `SQLiteStore.start()` reopens the database after a `stop()`. The bot closes the store on `bot.stop()` and when a start fails (e.g. the transport could not connect), so the next `bot.start()` used to fail with `The database connection is not open`. The `schedules()` and `durability()` backends it handed out follow the new connection. `start()` and `stop()` are idempotent. An in-memory database (`file: ':memory:'` or `''`) is kept open by `stop()`, since closing it would discard its data and the next `start()` would silently begin from an empty database.
  
  Opening errors are actionable and name the file: a missing directory, a file that is not a SQLite database (`code: 'SQLITE_NOTADB'`; the file handle is now released instead of staying locked) and a `better-sqlite3` native module that was never built (pnpm 10+ skips build scripts until `pnpm approve-builds`) or was built for another Node.js version, instead of a dozen probed paths.
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
- Updated dependencies [a2c946a]
- Updated dependencies [5ad624e]
  - @botmesh/core@2.0.0-beta.3

## 0.2.0-alpha.0

### Minor Changes

- b95b523: Implement the optional `IStore.setCheckpointIf` / `clearCheckpointIf` compare-and-set checkpoint writes (one atomic statement), used by `ConversationRuntime` with `coordination`.
- 5196990: Durable scheduler tasks (opt-in). `bot.schedule/every/delay(spec, { id, missed, maxCatchUp, leaseMs }, (run) => ...)` persists the next run in a `ScheduleStore` (`BotConfig.scheduler.store`, in memory by default), applies a missed-run policy (`skip`, `run-once` or `catch-up`) to slots no replica ran in time and claims each occurrence under a fenced lease so replicas never run it concurrently (at least once; `run.occurrenceKey` is an idempotency key). `bot.forgetTask(id)` deletes a stored schedule (orphans, one-shot tombstones); fencing tokens never go backwards for an id, even across deletes. Optional scheduler leadership (`scheduler.lease`, type `SchedulerLease`): a fenced `LeaseProvider` (`MemoryLeaseProvider`, new contract) or the multi-replica `Coordinator`, which a bot with `BotConfig.coordination` uses by default. `@bot-wa/sqlite-store` adds `SQLiteStore#schedules()` (and `SQLiteScheduleStore`, whose constructor takes a structural `SQLiteDatabaseLike`, so consumers need no `@types/better-sqlite3`); `@bot-wa/redis-store` adds `RedisStore#schedules()` and the fenced `RedisStore#leases()`. Tasks without `id` behave as before.
- 9bb875e: `SQLiteDurableKv` and `SQLiteDurability`: core's `DurableKv` and durability backend (`BotConfig.durability`) on SQLite, in one table `durable` whose every write is a single statement conditioned on the stored version (atomic compare-and-set across processes on one file). `store.durability()` returns the backend on the store's own connection (`new Bot({ store, durability: { journal: store.durability() } })`); its `kv` is also what the product packages (`@bot-wa/inbox`, `@bot-wa/crm`, `@bot-wa/campaigns`, `@bot-wa/deployments`, `@bot-wa/hub`) persist to. Opt-in: nothing changes for existing stores until it is called.
- 2c4f9f0: `messageKey(ref)` percent-escapes `%` and `:` in the chat id and the message id, so ids that contain `:` (Twilio's `whatsapp:+1…` chat ids) no longer collide; keys of ids without `:` or `%` are unchanged. New `legacyMessageKey(ref)` returns the old unescaped key. SQLite and Redis stores write the new key, still read and delete rows stored under the legacy key (checking the stored `ref` is the requested message, since a legacy key can be another message's new key), and drop the legacy copy when a message is saved again — no manual migration.
- 1a81406: New `purgeBatchSize` option (default `1000`): `purgeExpiredUserData` deletes expired `ctx.user` rows in batches and yields to the event loop between them, instead of one unbounded `DELETE`.
- 522bcca: Implement the `ctx.user` storage methods (`getUserData`, `setUserData`, `deleteUserData`, `listUserData`, `purgeExpiredUserData`). SQLite adds a `user_data` table with an expiry index; Redis stores one `{prefix}:ud:…` key per entry with native `PX` expiry.

### Patch Changes

- ce7790f: Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
- 3060501: `upsertChat`/`upsertContact` are atomic (read and write in one `IMMEDIATE` transaction), so concurrent partial upserts of one record no longer drop each other's fields. Aligned with `MemoryStore`: messages without `ref.id` or `chatId` are ignored, `getMessagesByChat` normalises `limit` (non-positive → none, fraction → rounded up, `Infinity` or any huge number → all; a negative limit used to return everything), `setUserData` rejects a non-JSON value with a `TypeError`, and an invalid `maxMessagesPerChat` throws a `RangeError`. Statements are prepared once per store.
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
- Updated dependencies [27620ef]
- Updated dependencies [e4574e6]
- Updated dependencies [ce7790f]
- Updated dependencies [b95b523]
- Updated dependencies [5196990]
- Updated dependencies [2c4f9f0]
- Updated dependencies [efb1fa6]
- Updated dependencies [4fc0560]
  - @bot-wa/core@2.0.0-alpha.2
