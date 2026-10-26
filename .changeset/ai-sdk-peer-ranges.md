---
'@botmesh/ai': patch
---

The optional SDK peers accept the current majors: `@anthropic-ai/sdk` `^0.68.0 || ^1.0.0`, `openai` `^6.48.0 || ^7.0.0` and `@google/generative-ai` up to `0.24.x`. Before, `pnpm add @botmesh/ai@alpha @anthropic-ai/sdk` (or `openai`) installed a version outside the declared range, which pnpm reports as an unmet peer and npm can refuse with `ERESOLVE`. Both the oldest and the newest SDK of each range were checked against local fakes of the three HTTP APIs (text, tool calls with their results, streaming and usage).
