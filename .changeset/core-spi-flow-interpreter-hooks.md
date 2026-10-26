---
'@botmesh/core': minor
---

`@botmesh/core/spi` exports the two flow-interpreter hooks the core interpreter uses, now under semver: `pauseControls(controls, ms)` (a pause that ends early when the conversation is aborted, replaced or the bot stops, then throws if the conversation is gone) and `runFormStep(form, ctx, c, opts?, flowTimeoutMs?)` (runs a native or degraded form and stores its answers). Code that runs declarative steps inside a `do`, such as `@botmesh/flow-schema`, imports them from the SPI instead of `@botmesh/core/internal`. They stay available from `/internal` as well.
