---
'@botmesh/core': patch
---

Durability hardening. `FileDurability.open()` refuses a journal it cannot read back (an empty or truncated snapshot, malformed rows, a damaged append-log entry) with an error that names the file and says how to recover, instead of a bare `SyntaxError`/`TypeError` or a half-applied journal; `MemoryKv.restore()` validates every row. The append-only log is read in linear time (it re-measured the whole prefix for every line, so a long log took seconds or minutes to open). `durability.inbox.leaseMs` / `outbox.leaseMs` below 20 ms are rejected with a `ConfigValidationError`: they were clamped silently, the heartbeat could not keep them, and a message handled fine ended dead-lettered.
