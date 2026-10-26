---
'create-botmesh': patch
---

The generated `bot.js` registers its menu flow with `bot.use(flow)` instead of the deprecated `bot.useFlow(flow)`.
