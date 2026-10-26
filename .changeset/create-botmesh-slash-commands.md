---
'create-botmesh': patch
---

The `baileys`, `meta`, `telegram` and `ai` templates install `slashCommandsPlugin` (before `aiPlugin` in `ai`). Before, `/reset` or `/cancel` typed at the `menu` flow's question was taken as the answer (the bot replied `🏓 ¡pong!`), `/help` got no reply, and in the `ai` template every command went to the LLM.
