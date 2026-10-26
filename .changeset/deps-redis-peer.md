---
'@botmesh/redis-store': minor
---

**Breaking: `redis` is a peer dependency, and node-redis 5 and 6 are supported.** `redis` moved from `dependencies` to `peerDependencies` with the range `^4.7.0 || ^5.0.0 || ^6.0.0`; npm and pnpm install it on their own when it is missing. The store, the coordinator, the durability backend, the schedule store and the lease provider work with node-redis 4, 5 and 6, on a single node and on Redis Cluster, with RESP2 or RESP3 (the node-redis 6 default). Every real-server suite runs against each major.

- `NativeRedisClient` and `NativeRedisClusterClient` are now small structural interfaces instead of `ReturnType<typeof createClient>` / `ReturnType<typeof createCluster>`, so the client of any supported major type-checks. Code that used these types to call Redis commands should use the type from `redis` itself.
- Own cluster clients also listen to `node-error`: node-redis 5 and 6 report a dropped node connection with that event instead of `error`, and it was not logged.
- The default key prefix stays `'botwa'`: data already stored lives under it.
