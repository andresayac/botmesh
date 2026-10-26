---
"@botmesh/meta": patch
"@botmesh/messenger": patch
---

`CloudAPIProvider.ingest()` and `MessengerProvider.ingest()` answer `503` while the provider is stopped (after `bot.stop()`, until the next `bot.start()`), like `@botmesh/instagram` and `@botmesh/telegram`. Before, a webhook that arrived while the bot was stopped was acknowledged with `200` and the message was lost; now Meta delivers it again after the restart.
