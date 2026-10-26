---
'@botmesh/sqlite-store': minor
---

Schema versioning: the database records its layout in `PRAGMA user_version` (`SQLITE_SCHEMA_VERSION`, now `1`) and opening it runs the pending migrations in order, each in its own `IMMEDIATE` transaction with the version bump. Files written by earlier releases (version `0`) are upgraded in place with every row kept. **Breaking:** a file written by a newer release is refused, untouched, with the new `SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`, `found`, `supported`). New `busyTimeoutMs` option (default 5000, `PRAGMA busy_timeout`); `logger` accepts any `LoggerLike` (every method optional). The exported `SCHEDULES_SCHEMA` and `DURABLE_SCHEMA` DDL strings are deprecated.
