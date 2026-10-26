---
'@botmesh/sqlite-store': minor
---

Schema version 2 (`SQLITE_SCHEMA_VERSION`): the durable scheduler's tables (`schedules`, `schedule_fences`) and the durability table (`durable` and its partial indexes) are part of the versioned migrations and are created when the database is opened. They used to be created ad hoc, outside the schema version, the first time `schedules()` or `durability()` was called. Files at version 0 or 1 are upgraded in place, keeping the rows of tables that already existed. `SQLiteScheduleStore` and `SQLiteDurableKv` built on a bare connection still create their table if it is missing.
