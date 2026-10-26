---
'@botmesh/postgres-store': patch
---

Hardening from the beta release test against a real PostgreSQL:

- `tablePrefix` longer than 42 characters now throws a `RangeError` in `PostgresStore`, `PostgresScheduleStore` and `PostgresDurability`. PostgreSQL truncates names to 63 bytes, and a long prefix made `chats`/`checkpoints` and `contacts`/`conversations` land in the same table without any error.
- A `stop()` called while `start()` is still connecting waits for it and ends the new pool (it used to leave the store started with an open pool). Same in `PostgresDurability`.
- With an injected `pool`, using the store (or `PostgresDurability`) before the first `start()` fails with the "not started — call start()" error, as documented, instead of a missing-table error. After `stop()` it keeps working on the injected pool, so bots that share one store or one durability backend (its `scope()` views) do not break when one of them stops. `PostgresDurability.start()` is a no-op while started.
- `PostgresDurability.stop()` reports a failure to end its own pool to `logger.error` instead of rejecting, like `PostgresStore`.
- `getMessage` finds a message whose id or chat id holds a lone UTF-16 surrogate (stored as U+FFFD); it used to report it missing.
