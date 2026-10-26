---
'@botmesh/core': patch
---

`BotConfig.rateLimit` is deprecated: nothing in the core ever read it (pacing moved to the transports in v2). Setting it now logs a warning when the bot is constructed. Configure pacing on the provider (e.g. `new BaileysProvider({ rateLimit })`) and the retry of rate-limited replies with `BotConfig.rateLimitRetry`. The `DurabilityConfig.backend` TSDoc names the real backends (`new PostgresDurability(...)`, `new RedisDurability(...)`, `SQLiteStore#durability()`).
