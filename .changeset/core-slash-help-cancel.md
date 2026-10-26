---
'@botmesh/core': patch
---

`slashCommandsPlugin`: the built-in `/help` text lists `/cancel` (it was installed but not listed) and `/cancel` answers `✅ Conversación cancelada.` / `✅ Conversation cancelled.` instead of the `/reset` text. Override `core.commands.help` / `core.commands.cancel` with `bot.locale()` to keep custom wording.
