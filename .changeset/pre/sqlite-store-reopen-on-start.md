---
'@botmesh/sqlite-store': patch
---

`SQLiteStore.start()` reopens the database after a `stop()`. The bot closes the store on `bot.stop()` and when a start fails (e.g. the transport could not connect), so the next `bot.start()` used to fail with `The database connection is not open`. The `schedules()` and `durability()` backends it handed out follow the new connection. `start()` and `stop()` are idempotent. An in-memory database (`file: ':memory:'` or `''`) is kept open by `stop()`, since closing it would discard its data and the next `start()` would silently begin from an empty database.

Opening errors are actionable and name the file: a missing directory, a file that is not a SQLite database (`code: 'SQLITE_NOTADB'`; the file handle is now released instead of staying locked) and a `better-sqlite3` native module that was never built (pnpm 10+ skips build scripts until `pnpm approve-builds`) or was built for another Node.js version, instead of a dozen probed paths.
