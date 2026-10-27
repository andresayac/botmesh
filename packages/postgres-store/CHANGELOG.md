# @botmesh/postgres-store

## 1.0.0-beta.0

### Major Changes

- 0af51cd: First public release of the PostgreSQL, MySQL/MariaDB and MongoDB stores. API frozen like the other public stores:
  
  - The database drivers (`pg`, `mysql2`, `mongodb`) are now **peer dependencies**, loaded only when a store (or `PostgresDurability`) creates its own pool or client; a missing driver fails with an install hint. Injected pools and clients need nothing else.
  - No published declaration names a driver type: `NativePostgresPool`, `NativeMysqlPool` and `NativeMongoClient` are structural interfaces that a real `pg.Pool`, mysql2 pool or `MongoClient` satisfies, so `@types/pg` is no longer a dependency of `@botmesh/postgres-store`.
  - `logger` takes `Partial<LoggerLike>` in every store and in `PostgresDurability`.
  - `@botmesh/mysql-store`: `PoolLike` and `ConnectionLike` are now `MysqlPoolLike` and `MysqlConnectionLike`. A single statement picked as a deadlock victim is retried (up to 5 times): concurrent saves and `maxMessagesPerChat` trims of one chat deadlocked on MariaDB.
  - `@botmesh/mongo-store`: accepts the `mongodb` 6.x and 7.x drivers. With 7.x on a standalone server, `deleteChat` failed (the driver reports the missing transaction support differently); it now falls back to two deletes as with 6.x. `ScheduleDoc` is now `MongoScheduleDoc`, and `MongoLikeSession` is exported. A store that builds its own client creates it on `start()`: calls before `start()` reject with a "not started" error.

### Patch Changes

- 3208a7c: Hardening from the beta release test against a real PostgreSQL:
  
  - `tablePrefix` longer than 42 characters now throws a `RangeError` in `PostgresStore`, `PostgresScheduleStore` and `PostgresDurability`. PostgreSQL truncates names to 63 bytes, and a long prefix made `chats`/`checkpoints` and `contacts`/`conversations` land in the same table without any error.
  - A `stop()` called while `start()` is still connecting waits for it and ends the new pool (it used to leave the store started with an open pool). Same in `PostgresDurability`.
  - With an injected `pool`, using the store (or `PostgresDurability`) before the first `start()` fails with the "not started — call start()" error, as documented, instead of a missing-table error. After `stop()` it keeps working on the injected pool, so bots that share one store or one durability backend (its `scope()` views) do not break when one of them stops. `PostgresDurability.start()` is a no-op while started.
  - `PostgresDurability.stop()` reports a failure to end its own pool to `logger.error` instead of rejecting, like `PostgresStore`.
  - `getMessage` finds a message whose id or chat id holds a lone UTF-16 surrogate (stored as U+FFFD); it used to report it missing.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
