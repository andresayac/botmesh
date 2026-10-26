---
'@botmesh/core': minor
'@botmesh/ai': minor
---

New `'stopping'` bot event: `bot.stop()` on a running bot emits it right after inbound is closed, before the drain and the transport stop (`'stopped'` still comes last; a throwing listener goes to `'error'`). `@botmesh/ai` now aborts its in-flight model calls on `'stopping'` instead of `'stopped'`, so nothing waits on the model while the transport is stopping.
