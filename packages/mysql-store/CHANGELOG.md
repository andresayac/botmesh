# @botmesh/mysql-store

## 1.0.0-beta.0

### Major Changes

- 0af51cd: First public release of the PostgreSQL, MySQL/MariaDB and MongoDB stores. API frozen like the other public stores:
  
  - The database drivers (`pg`, `mysql2`, `mongodb`) are now **peer dependencies**, loaded only when a store (or `PostgresDurability`) creates its own pool or client; a missing driver fails with an install hint. Injected pools and clients need nothing else.
  - No published declaration names a driver type: `NativePostgresPool`, `NativeMysqlPool` and `NativeMongoClient` are structural interfaces that a real `pg.Pool`, mysql2 pool or `MongoClient` satisfies, so `@types/pg` is no longer a dependency of `@botmesh/postgres-store`.
  - `logger` takes `Partial<LoggerLike>` in every store and in `PostgresDurability`.
  - `@botmesh/mysql-store`: `PoolLike` and `ConnectionLike` are now `MysqlPoolLike` and `MysqlConnectionLike`. A single statement picked as a deadlock victim is retried (up to 5 times): concurrent saves and `maxMessagesPerChat` trims of one chat deadlocked on MariaDB.
  - `@botmesh/mongo-store`: accepts the `mongodb` 6.x and 7.x drivers. With 7.x on a standalone server, `deleteChat` failed (the driver reports the missing transaction support differently); it now falls back to two deletes as with 6.x. `ScheduleDoc` is now `MongoScheduleDoc`, and `MongoLikeSession` is exported. A store that builds its own client creates it on `start()`: calls before `start()` reject with a "not started" error.

### Patch Changes

- 71cf52c: Harden the connection setup and the input limits. A malformed `uri` (or one that is not `mysql://`/`mariadb://`, or holds an unencoded `#`, or an `@` after the host, the sign of an unencoded `/` or `?` in the password) now throws a `TypeError` from the constructor that never repeats the URI, instead of Node's `Invalid URL` error carrying the password in its `input`. `uri` and the discrete options combine (the discrete ones override the matching parts) instead of the URI being silently dropped. When `start()` cannot reach the server it names `host:port` and the database (mysql2 reported a refused `localhost` with an empty message), keeping `err.code` and the original error as `cause`. `tablePrefix` is limited to 43 characters (55 for `MysqlScheduleStore`), so a long prefix no longer leaves half the tables created. Ids over 1024 bytes and `ctx.user` values of 16 MiB or more fail with a `RangeError` before anything is written. A statement of 1 MiB or more runs on its own connection, closed when it fails (a statement over `max_allowed_packet` used to leave a dead connection in the pool that failed the next statement); a statement that could not be written to an already-closed connection is sent once more; and `stop()` during `start()` closes the pool being created.
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
