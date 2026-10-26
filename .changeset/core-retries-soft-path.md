---
'@botmesh/core': patch
---

Soft path for the new meaning of `retries`: the first time a wait, form or flow step sets `retries` without `maxAttempts`, the bot logs one warning (`logger.warn`, once per bot) saying that `retries: N` now allows N + 1 answers and that `maxAttempts` states the total. `MemoryCoordinationHub({ maxIdleKeys: 0 })` no longer evicts the chat it is about to use (every turn failed with `LeaseLostError('superseded')`); `0` now keeps only the most recent idle chat.
