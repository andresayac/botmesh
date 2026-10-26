---
'@botmesh/core': minor
'@botmesh/meta': minor
---

Long text is split into several messages automatically.

**Breaking (behaviour):** a `text` send longer than the provider's `capabilities.maxTextLength` (UTF-16 code units) or the new `capabilities.maxTextBytes` (UTF-8 bytes) is no longer passed to the provider whole (which rejected it with `PayloadTooLargeError` on Telegram, Discord, Messenger and Instagram): the core sends it as several messages, in order. Set `new Bot({ splitLongText: false })` to keep the old behaviour.

- Cuts land on the most natural boundary that fits (paragraph, line, sentence, word) and never inside a grapheme (surrogate pairs, ZWJ emoji sequences, flags, skin tones) or the chat's markup: links and URLs stay whole; a fenced code block, inline code, an emphasis run or an HTML element longer than the limit is closed at the end of a part and reopened at the start of the next (the fence keeps its language).
- `before('send')` hooks run once on the whole text, and what they return is split: a footer or a translation applies to the whole message and every part still fits (a hook that makes a short text too long gets it split too, its explicit key suffixed from `#1`); an `abort()` skips the whole text. Each part is then a send of its own: `after('send')` hooks, the message log and the durable outbox see each part. Only the first part keeps `options.quoted`; an explicit `idempotencyKey` gets a `#2`, `#3`… suffix from the second part on. A failing part rejects the send and the rest is not sent.
- Durability: when the outbox defers a part (`SendDeferredError`), the parts after it are journaled behind it, so the sweeper delivers every part, in order. `bot.enqueue()` splits too, into one record per part (`key`, `key#2`, …).
- The splitter runs in linear time: the markup of a text is scanned once, with no pattern that rescans to the end of the line for an unclosed `_`, `*`, `[` or tag.
- `SendResult` / `SentMessage` gain `parts?: MessageRef[]` (every part, in order; `ref` is the last one).
- New `ProviderCapabilities.maxTextBytes`; `MockProvider` takes a `maxTextBytes` option. `ctx.stream()` honours it too.
- `splitMessage(text, limit)` and `findSplitPoint(text, limit)` accept `{ maxLength?, maxBytes?, format? }` (new exported type `SplitTextOptions`) as well as a plain length.
- `@botmesh/meta`: the Cloud API provider declares `maxTextLength: 4096` (its `text.body` limit), so longer text is split instead of failing at Graph.
