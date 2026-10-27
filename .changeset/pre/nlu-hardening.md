---
"@botmesh/nlu": patch
---

Matching and validation fixes before the first release:

- Confidence stays within `[0, 1]`: a word repeated in an utterance (`'no no no'`) counts once, so it no longer scores above 1, and a word or phrase repeated in the input (`'hola hola'`) lowers the score instead of reaching 1, so it never ties or beats an exact match of another intent.
- `contains` only counts whole words (`my order` is no longer found in `my orders`).
- Normalization folds full-width letters and ligatures (NFKD), strips Hebrew points and Arabic harakat like Latin accents, removes invisible format characters (zero-width spaces, soft hyphens) instead of splitting the word, and keeps the vowel signs of scripts such as Devanagari or Thai inside their word.
- `define()` throws, leaving the intent unchanged, on a phrase with no letters or digits (emoji or punctuation only: it could never match), a non-string entry (it was dropped silently), a slot name used twice, the reserved slot name `__proto__`, and slots glued only by a character that normalization removes.
- `match()` / `rank()` throw a clear `TypeError` for a non-string text; `whenIntent()` throws a clear `TypeError` for a missing engine (for example `bot.injectTools.nlu` before plugging `nluPlugin`), an empty intent or a non-function handler.
- The engine remembers the scores of the last text, so the predicate and handler of every `whenIntent` on one engine score a message once instead of twice per registered intent. `rank()` returns copies.
- `nluPlugin` removes `ctx.tools.nlu` when unplugged and rejects an `intents` value that is not a plain object.
