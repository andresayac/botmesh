---
'@botmesh/core': minor
'@botmesh/baileys': minor
'@botmesh/meta': minor
'@botmesh/telegram': minor
---

**Breaking (behaviour):** one policy for presence hints while the transport is disconnected. `ctx.typing()`, `ctx.recording()`, `ctx.markRead()` and the automatic typing indicator are best-effort: while the provider's last connection state is not `'ready'`, or once the bot is stopped, the bot does not call the provider; the hint resolves, is logged at debug and counted in the new `metrics().presenceSkipped` (`{ typing, markRead }`, `botmesh_presence_skipped_total{kind}` in `toPrometheus()`). The rule is part of the `IProvider` contract ("PRESENCE WHILE DISCONNECTED"); Baileys, the Cloud API and Telegram (and the other built-in channels) follow it when called directly too: `markRead()` / `typing()` resolve without contacting the transport while not connected. New `checkPresenceWhileDisconnected` / `assertPresenceWhileDisconnected` in `@botmesh/core/testing`.
