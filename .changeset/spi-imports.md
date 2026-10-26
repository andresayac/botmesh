---
'@botmesh/baileys': patch
'@botmesh/meta': patch
'@botmesh/telegram': patch
'@botmesh/sqlite-store': patch
'@botmesh/redis-store': patch
---

Import the backend and transport helpers (`toInboundLocation`, `messageKey`, `KvDurability`, the schedule and form helpers, `I18n`) from the new `@botmesh/core/spi` subpath, so these packages need the `@botmesh/core` version that ships it. No behaviour change. The doc examples use `durability: { backend }` (`journal` is its deprecated name).
