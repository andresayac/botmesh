---
'@botmesh/redis-store': minor
---

**Breaking:** the cluster key-layout internals move to a new subpath without a semver promise, `@botmesh/redis-store/internal`: the key builders (`storeKeys`, `coordKeys`, `scheduleKeys`, `userDataKeys` and their types), `bucketOf`, `encodeSegment`, `INDEX_BUCKETS`, `LAYOUT_MARKER`, `hashSlot`, `hashTagOf`, `assertOneSlot` and `assertLayoutPrefix`. The main entry keeps the `layout` option, `RedisKeyLayout`, `migrateToClusterLayout()`, `inspectKeyspace()`, `isRedisClusterClient()` and `withClusterRetry()`, and still re-exports the five values it used to export (`INDEX_BUCKETS`, `LAYOUT_MARKER`, `bucketOf`, `encodeSegment`, `hashSlot`) as `@deprecated`.

**Breaking:** the deprecated `ttl` option (seconds) and `RedisStore.acquireLock()` are removed. Use `sessionTtl` (`ttl: 3600` is `sessionTtl: '1h'`) and `acquireLockFenced(key, ttlMs)` (`(await store.acquireLockFenced(k, ms))?.token` replaces `await store.acquireLock(k, ms)`; same lock key). Passing `ttl` from JavaScript throws a `TypeError`, and calling `acquireLock` rejects with one, both naming the replacement.
