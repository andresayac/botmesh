---
'@botmesh/core': patch
---

`bot.stop()` lets sends still in flight and the bookkeeping of sends the provider already accepted (after-send hooks and the outbound message-log row) finish, up to 5 s, before it closes the store, with or without `drain`. A reply sent right before `stop()` was missing from the message log and the store's "closed" error (e.g. `The client is closed` with `RedisStore`) reached the `'error'` event.
