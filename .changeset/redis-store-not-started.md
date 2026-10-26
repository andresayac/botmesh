---
'@botmesh/redis-store': patch
---

A store that creates its own client, used before `start()` or after `stop()`, now fails with an error that says to call `store.start()` (which `bot.start()` does) instead of node-redis' bare `The client is closed`. An injected client is not affected.
