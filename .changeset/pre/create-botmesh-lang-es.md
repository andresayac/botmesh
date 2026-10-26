---
'create-botmesh': minor
---

The generated bots (Spanish templates) set `lang: 'es'` on `new Bot(...)`, so their built-in texts (slash commands, retries, timeouts) stay in Spanish now that `@botmesh/core` defaults to English. The generated `AGENTS.md` explains the option.
