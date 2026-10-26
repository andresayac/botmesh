---
'@botmesh/core': patch
---

`@botmesh/core/internal` exports `pauseControls(controls, ms)`, the cancellable pause the step interpreter uses: it ends early when the conversation is aborted, replaced or the bot stops, then throws if the conversation is gone. It is internal-only (not re-exported by the main entry, no semver guarantee); `@botmesh/flow-schema` uses it so nested `delay` steps no longer keep a timer alive after `bot.stop()`.
