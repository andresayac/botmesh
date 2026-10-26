# @botmesh/redis-store

## 1.0.0-beta.1

### Major Changes

- 79af076: First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).

### Minor Changes

- 94c4c4d: **Breaking: `redis` is a peer dependency, and node-redis 5 and 6 are supported.** `redis` moved from `dependencies` to `peerDependencies` with the range `^4.7.0 || ^5.0.0 || ^6.0.0`; npm and pnpm install it on their own when it is missing. The store, the coordinator, the durability backend, the schedule store and the lease provider work with node-redis 4, 5 and 6, on a single node and on Redis Cluster, with RESP2 or RESP3 (the node-redis 6 default). Every real-server suite runs against each major.
  
  - `NativeRedisClient` and `NativeRedisClusterClient` are now small structural interfaces instead of `ReturnType<typeof createClient>` / `ReturnType<typeof createCluster>`, so the client of any supported major type-checks. Code that used these types to call Redis commands should use the type from `redis` itself.
  - Own cluster clients also listen to `node-error`: node-redis 5 and 6 report a dropped node connection with that event instead of `error`, and it was not logged.
  - The default key prefix stays `'botwa'`: data already stored lives under it.
- be1feac: **Breaking:** the cluster key-layout internals move to a new subpath without a semver promise, `@botmesh/redis-store/internal`: the key builders (`storeKeys`, `coordKeys`, `scheduleKeys`, `userDataKeys` and their types), `bucketOf`, `encodeSegment`, `INDEX_BUCKETS`, `LAYOUT_MARKER`, `hashSlot`, `hashTagOf`, `assertOneSlot` and `assertLayoutPrefix`. The main entry keeps the `layout` option, `RedisKeyLayout`, `migrateToClusterLayout()`, `inspectKeyspace()`, `isRedisClusterClient()` and `withClusterRetry()`, and still re-exports the five values it used to export (`INDEX_BUCKETS`, `LAYOUT_MARKER`, `bucketOf`, `encodeSegment`, `hashSlot`) as `@deprecated`.
  
  **Breaking:** the deprecated `ttl` option (seconds) and `RedisStore.acquireLock()` are removed. Use `sessionTtl` (`ttl: 3600` is `sessionTtl: '1h'`) and `acquireLockFenced(key, ttlMs)` (`(await store.acquireLockFenced(k, ms))?.token` replaces `await store.acquireLock(k, ms)`; same lock key). Passing `ttl` from JavaScript throws a `TypeError`, and calling `acquireLock` rejects with one, both naming the replacement.

### Patch Changes

- 54ebba3: README rework for the stable line: one structure (what it is, install, quick start, options, errors, links), a single note about the prerelease dist-tag instead of hard-coded `@alpha` commands, no stale "alpha/experimental" banners, English examples and canonical option names only. Fixes wrong samples: `secureFetch` resolves `{ url, response, body }` with the body already read (the old sample called `response.json()`), the Meta webhook sample keeps the raw body with `express.raw()` (no `any` casts), the Meta pricing sample was not valid TypeScript, and the Redis Cluster sample passes `rootNodes` as URL strings. Documents the previously missing exports (`assertSafeTarget`, `isAllowedHostUrl`, `isPrivateAddress`, `graphRequest`, `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS`) and the errors users hit (pnpm build scripts, `better-sqlite3` on Node.js 24.19, Graph `190`/`100`/`131030`, Telegram `404`).
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
- 8ef7548: Checkpoint compare-and-set (`setCheckpointIf` / `clearCheckpointIf`, used with `BotConfig.coordination`) no longer depends on Redis' cjson decoding the stored checkpoint. A `c.state` holding a lone UTF-16 surrogate (a message cut in the middle of an emoji) made cjson fail, the stored revision read as 0 and every later write of that conversation was refused as if another replica owned it. The scripts now report an undecodable value and the store decides in JS, writing only while the key still holds the exact string it read. Both layouts (legacy and cluster).
- f0ba7fb: A store that creates its own client, used before `start()` or after `stop()`, now fails with an error that says to call `store.start()` (which `bot.start()` does) instead of node-redis' bare `The client is closed`. An injected client is not affected.
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
- Updated dependencies [a2c946a]
- Updated dependencies [5ad624e]
  - @botmesh/core@2.0.0-beta.3

## 0.2.0-alpha.0

### Minor Changes

- 397c2be: Add `sessionTtl` (a duration such as `'24h'`, or milliseconds, like every duration option of `@bot-wa/core`) and deprecate `ttl` (seconds). Setting both throws a `RangeError`. Export the `RedisMulti` type.
- 2760b89: Redis Cluster support (opt-in). Pass a node-redis cluster client, or the new `cluster: { rootNodes, nodeAddressMap?, defaults? }` option (also on `RedisCoordinator` and `RedisDurability`), and `RedisStore`, `coordinator()`, `schedules()`, `leases()` and `RedisDurability` switch to the `'cluster'` key layout (new `layout` option). In that layout every multi-key script stays in one hash slot (hash-tagged key groups), listings read per-bucket index sorted sets instead of `KEYS`/`SCAN`, and `MULTI` is not used. `TRYAGAIN`/`CLUSTERDOWN` and redirects node-redis did not follow are retried (`withClusterRetry`). Without configuration nothing changes: the default `'legacy'` layout keeps every key name, script and command.
  
  A node-redis 4 cluster client now has its `EVAL` routed by its first key (`cluster.eval(script, { keys })` used the wrong argument and could fail with `MOVED`). This also fixes `RedisDurability`, `RedisScheduleStore` and `RedisLeaseProvider` on a cluster client.
  
  New `migrateToClusterLayout()` copies an existing keyspace offline, in place or into a cluster. It keeps TTLs, fences, terms and schedule fencing tokens only grow, it is resumable, and the layout marker is written only by a complete run. `direction: 'cluster-to-legacy'` rolls back into a single node, from a single node or a cluster client; it mirrors by default (`mirror`), so writes and deletions made after the forward pass are carried back, and it removes the marker. A legacy-layout `RedisStore` on a prefix carrying the marker warns at `start()`. `inspectKeyspace()` counts keys per layout. Clients that `RedisCoordinator` and `RedisDurability` create (`url` or `cluster`) now always have an `'error'` listener (new `logger` option on `RedisDurability`), so a dropped connection no longer crashes the process. Also exported: `isRedisClusterClient`, `hashSlot`, `bucketOf`, `encodeSegment`, `INDEX_BUCKETS`, `LAYOUT_MARKER`, and the related types.
- 99251ef: New `RedisCoordinator` (also `store.coordinator()`), the Redis backend of `BotConfig.coordination`: per-chat ticket FIFO and turn hand-off in Lua (tickets of dead replicas are skipped), `PX`-leased turns and leaderships renewed by a watchdog that gives them up locally before they can expire server-side, and leadership terms as fencing tokens. Each instance writes under its own `incarnation` (`replicaId` plus a nonce), so a restart with a fixed `replicaId` never revives a dead process's tickets, and a release, cancel or reservation that fails on the wire is repaired by the watchdog. New `acquireLockFenced(key, ttlMs)` (returns `{ token, fence }`; the fence grows on every acquisition) and `renewLock(key, token, ttlMs)`; `acquireLock` is unchanged and deprecated in their favour.
- 40fdab4: New `RedisDurability` backend for `BotConfig.durability` (durable inbox/outbox). Each record is a versioned string written by a single Lua script that compares the current value, writes the new one and updates the record's `due`/`done` sorted sets atomically. Keys live under `{prefix}:{durable:inbox|outbox[:<scope>]}` (one scope per bot namespace), so the script is Redis Cluster safe and never touches `RedisStore` keys.
- b95b523: Implement the optional `IStore.setCheckpointIf` / `clearCheckpointIf` compare-and-set checkpoint writes (one Lua script per write, including the Redis Cluster layout), used by `ConversationRuntime` with `coordination`.
- 5196990: Durable scheduler tasks (opt-in). `bot.schedule/every/delay(spec, { id, missed, maxCatchUp, leaseMs }, (run) => ...)` persists the next run in a `ScheduleStore` (`BotConfig.scheduler.store`, in memory by default), applies a missed-run policy (`skip`, `run-once` or `catch-up`) to slots no replica ran in time and claims each occurrence under a fenced lease so replicas never run it concurrently (at least once; `run.occurrenceKey` is an idempotency key). `bot.forgetTask(id)` deletes a stored schedule (orphans, one-shot tombstones); fencing tokens never go backwards for an id, even across deletes. Optional scheduler leadership (`scheduler.lease`, type `SchedulerLease`): a fenced `LeaseProvider` (`MemoryLeaseProvider`, new contract) or the multi-replica `Coordinator`, which a bot with `BotConfig.coordination` uses by default. `@bot-wa/sqlite-store` adds `SQLiteStore#schedules()` (and `SQLiteScheduleStore`, whose constructor takes a structural `SQLiteDatabaseLike`, so consumers need no `@types/better-sqlite3`); `@bot-wa/redis-store` adds `RedisStore#schedules()` and the fenced `RedisStore#leases()`. Tasks without `id` behave as before.
- 2c4f9f0: `messageKey(ref)` percent-escapes `%` and `:` in the chat id and the message id, so ids that contain `:` (Twilio's `whatsapp:+1…` chat ids) no longer collide; keys of ids without `:` or `%` are unchanged. New `legacyMessageKey(ref)` returns the old unescaped key. SQLite and Redis stores write the new key, still read and delete rows stored under the legacy key (checking the stored `ref` is the requested message, since a legacy key can be another message's new key), and drop the legacy copy when a message is saved again — no manual migration.
- 522bcca: Implement the `ctx.user` storage methods (`getUserData`, `setUserData`, `deleteUserData`, `listUserData`, `purgeExpiredUserData`). SQLite adds a `user_data` table with an expiry index; Redis stores one `{prefix}:ud:…` key per entry with native `PX` expiry.

### Patch Changes

- ce7790f: Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
- cc7b1ad: `deleteChat` runs as one Lua script, so a message saved while a chat is being deleted can no longer survive as an orphan item; `deleteMessage` only removes an item that belongs to that chat's log.
- 31fcc2e: `upsertChat` / `upsertContact` are now atomic across replicas: the write is a compare-and-set Lua script that re-reads and merges again when another process changed the record in between, so concurrent upserts from any number of replicas never lose each other's fields. The merge runs in JS (`{ ...existing, ...patch }`, an explicit `undefined` removes the field), so values are stored byte-exact. Under pathological contention an upsert fails after 50 attempts.
- 522bcca: Real-server fixes: an unhandled client `'error'` no longer crashes the process on disconnect, `start()`/`stop()` no longer hang, trimming no longer over-prunes under concurrency, `KEYS` patterns are escaped, `limit`/`ttl`/cap values are normalised or validated, and same-key upserts are serialised in-process.
- f2907d5: Key listings (`listChats`, `listContacts`, `listCheckpoints`, `ctx.user` list and namespace deletes) use incremental `SCAN` through the client's `scanIterator` instead of the blocking `KEYS` (clients without it fall back to `KEYS`) and fetch records with parallel `GET`s. Aligned with `MemoryStore`: messages without `ref.id` or `chatId` are ignored, and `setUserData` rejects a non-JSON value with a `TypeError`.
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
