---
'@botmesh/core': patch
---

Fail fast on user mistakes that used to be silent, and keep errors in the logs:

- The engine's own error logs (`dispatch error`, `conversation error`, `resume failed`, …) now pass the error pino-style (`{ err }` first), so a pino logger records the error and its stack instead of dropping it.
- `new Bot({ provider })` names the mistake when `provider` is a class, a Promise or an object without `start`/`stop`/`send`/`onEvent` (it used to fail later with an unrelated store-namespace error).
- Every send is checked after the `before('send')` hooks: a `text` that is not a string (`ctx.reply(undefined)`), media without a source, coordinates out of range, or a poll/buttons message with no options reject with a `TypeError` instead of reaching the transport. Every documented `MediaSource` is accepted, including the provider escape hatch `{ native }` (Telegram `file_id`, Cloud API media id).
- A `ctx` reply (including a flow step's `say`/`ask`) that hits a `RateLimitedError` with a `retryAfterMs` of up to 5 s waits and retries it (at most twice) instead of ending the conversation with the generic error message. Longer waits and other errors surface as before; `bot.send()` is not retried (broadcasts keep their own back-off).
- A trigger that is `undefined`/`null` throws when it is registered (it matched the literal text "undefined").
- `bot.every()` rejects a zero, negative or non-finite interval (it spun on a 1 ms timer); `bot.delay()` rejects a negative or non-finite one; cron expressions with out-of-range values, reversed ranges or a zero step throw (they were accepted and never ran).
- `flow().ask()`/`.choose()` reject `'__proto__'` as a state key (the answer was silently lost).
- Test kit: `chat.expectReply()` no longer crashes on outbox entries without text.
