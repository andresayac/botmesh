---
'@botmesh/core': minor
---

Close three gaps found while writing the docs examples:

- `c.ask()` and `c.waitText()` accept a native button or list tap that carries text (`type: 'buttons' | 'list'` with a non-empty body: the button id or selected title, the same value `c.choose()` reads) as the answer, instead of re-prompting as if the user had sent media. Taps without text and media still re-prompt.
- `createTestBot()` from `@botmesh/core/testing` also takes a `defineBot` factory: `await createTestBot(createBot, options?)` calls it with the `MockProvider` (or its chaos wrapper) and starts the bot it returns. It throws a `TypeError` when the factory does not return a bot built on that provider.
- New `bot.unprovide(name)`, the inverse of `bot.provide()` (which still returns the bot for chaining): it removes the injected tool and returns whether one existed. Plugins call it from `ctx.onDispose()`.
