---
'@botmesh/telegram': patch
---

A 404 from the Bot API (a malformed bot token, or a `baseUrl` with the wrong path) now rejects with `Not Found — check the bot token and baseUrl` instead of a bare `ProviderError: Not Found`. The token is never echoed.
