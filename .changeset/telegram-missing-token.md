---
'@botmesh/telegram': patch
---

`new TelegramProvider({ token })` throws a `TypeError` naming `@BotFather` when the token is missing or empty (typically `process.env.TELEGRAM_TOKEN` before `.env` exists), instead of polling `/botundefined/getMe` and failing with a bare `ProviderError: Not Found`. A 404 from the Bot API now says to check the bot token and `baseUrl`. The token is never echoed.
