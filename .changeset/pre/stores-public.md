---
'@botmesh/postgres-store': major
'@botmesh/mysql-store': major
'@botmesh/mongo-store': major
---

First public release of the PostgreSQL, MySQL/MariaDB and MongoDB stores. API frozen like the other public stores:

- The database drivers (`pg`, `mysql2`, `mongodb`) are now **peer dependencies**, loaded only when a store (or `PostgresDurability`) creates its own pool or client; a missing driver fails with an install hint. Injected pools and clients need nothing else.
- No published declaration names a driver type: `NativePostgresPool`, `NativeMysqlPool` and `NativeMongoClient` are structural interfaces that a real `pg.Pool`, mysql2 pool or `MongoClient` satisfies, so `@types/pg` is no longer a dependency of `@botmesh/postgres-store`.
- `logger` takes `Partial<LoggerLike>` in every store and in `PostgresDurability`.
- `@botmesh/mysql-store`: `PoolLike` and `ConnectionLike` are now `MysqlPoolLike` and `MysqlConnectionLike`. A single statement picked as a deadlock victim is retried (up to 5 times): concurrent saves and `maxMessagesPerChat` trims of one chat deadlocked on MariaDB.
- `@botmesh/mongo-store`: accepts the `mongodb` 6.x and 7.x drivers. With 7.x on a standalone server, `deleteChat` failed (the driver reports the missing transaction support differently); it now falls back to two deletes as with 6.x. `ScheduleDoc` is now `MongoScheduleDoc`, and `MongoLikeSession` is exported. A store that builds its own client creates it on `start()`: calls before `start()` reject with a "not started" error.
