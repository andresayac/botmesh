# @botmesh/nlu

Lightweight, **fully local** intent matching for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core). Define intents with example phrases (utterances) and match the incoming text against them: no network calls, no ML models, no external services, no runtime dependency beyond `@botmesh/core`.

- **Deterministic scoring** over normalized text (case, accents and punctuation ignored).
- **`{slot}` entities**: `'my order {id}'` matches `'my order 12345'` and captures `{ id: '12345' }`.
- **Bot integration**: `nluPlugin` exposes the engine as `ctx.tools.nlu`, and `whenIntent` routes an intent to a handler; unmatched messages fall through to your other handlers.

It is a keyword/token-overlap matcher, not a full NLU (no embeddings, no stemming, no multilingual models). It works well for command-like intents ("my order", "cancel", "talk to a human"). For open-ended language, use [`@botmesh/ai`](https://www.npmjs.com/package/@botmesh/ai) instead of it or next to it, or [`@botmesh/dialogflow`](https://www.npmjs.com/package/@botmesh/dialogflow) for a hosted NLU.

## Install

```bash
pnpm add @botmesh/core @botmesh/nlu
```

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

## Quick start

```ts
import { Bot } from '@botmesh/core'
import { nluPlugin, whenIntent } from '@botmesh/nlu'

const bot = new Bot({ provider })
bot.plug(nluPlugin, {
  intents: {
    greeting: ['hello', 'hi', 'good morning'],
    'order.status': ['my order {id}', 'where is my order', 'order status'],
  },
})
const nlu = bot.injectTools.nlu!

whenIntent(bot, nlu, 'greeting', (ctx) => ctx.reply('Hi! How can I help?'))
whenIntent(bot, nlu, 'order.status', async (ctx, match) => {
  const id = match.entities?.id
  await ctx.reply(id ? `Looking up order ${id}…` : 'What is your order number?')
})

// Anything no intent matched:
bot.onMessage((ctx) => ctx.reply("Sorry, I didn't get that."))
await bot.start()
```

The engine also works on its own, without a bot:

```ts
import { IntentEngine } from '@botmesh/nlu'

const nlu = new IntentEngine() // default threshold: 0.5
nlu.define('greeting', ['hello', 'hi', 'good morning'])
nlu.define('order.status', ['my order {id}', 'order status', 'where is my order'])

nlu.match('HELLO!')                 // → { intent: 'greeting', confidence: 1 }
nlu.match('my order 12345')         // → { intent: 'order.status', confidence: 1, entities: { id: '12345' } }
nlu.match('order status please')    // → { intent: 'order.status', confidence: 0.9… }
nlu.match('zzz qqq')                // → null (nothing crosses the threshold)
```

## Options

`nluPlugin` (a plugin spec: `bot.plug(nluPlugin, config)`) and `new IntentEngine(options)`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `threshold` | `number` | `0.5` | Minimum confidence for `match()` to return a result. Must be in `[0, 1]`; anything else throws. |
| `intents` | `Record<string, string[]>` | — | `nluPlugin` only: intents to define at install, `{ name: [utterance, …] }`. Anything but a plain object throws. |

The config is typed: `bot.plug(nluPlugin, { threshhold: 0.9 })` is a compile error, and a config declared as `NluPluginConfig` can be passed as is.

## API

| Member | Description |
| --- | --- |
| `engine.define(intent, utterances)` | Adds example phrases to an intent (chainable). Calling it again for the same intent **appends**. Throws, leaving the intent unchanged, on an empty name, an empty list, a non-string entry, a phrase with no letters or digits (only emoji or punctuation: it could never match), adjacent slots, a slot name used twice or the reserved slot name `__proto__`. |
| `engine.match(text, threshold?)` | The best intent at or above the threshold, or `null`. The per-call threshold follows the same rule as the option. `text` must be a string (anything else throws a `TypeError`). |
| `engine.rank(text)` | Every intent with a positive score, best first. Useful for debugging and "did you mean…?" menus. The engine remembers the scores of the last text, so several `whenIntent` handlers on one engine score a message once (`define()` clears it); the results are copies you may change. |
| `engine.intents()` / `engine.threshold` | Intent names in definition order, and the configured threshold. |
| `nluPlugin` | Installs an engine as `ctx.tools.nlu` (typed by importing the package; `bot.injectTools.nlu` outside handlers). |
| `whenIntent(bot, engine, intent, handler)` | Runs `handler(ctx, match)` only when the text's **best** match is `intent`. Returns an unsubscribe function, like `bot.when`. Throws a `TypeError` when `engine` is missing (for example `bot.injectTools.nlu` before plugging `nluPlugin`), `intent` is empty or `handler` is not a function. |
| `normalizeText(text)` | The normalization the engine applies (accents, case, punctuation and invisible characters removed, full-width letters folded, whitespace collapsed). |

```ts
interface IntentMatch {
  intent: string                    // the matched intent name
  confidence: number                // score in [0, 1]
  entities?: Record<string, string> // captured {slot} values, when applicable
}
```

## `{slot}` entities

Utterances may contain `{name}` placeholders. A slot captures a **single
whitespace-delimited token** from the fully-normalized input (lowercased, diacritics
stripped). When the anchored slot pattern matches the whole input, confidence is `1`
and `entities` carries the captured values:

```ts
nlu.define('travel', ['flight from {origin} to {destination}'])
nlu.match('Flight from Bogotá to Lima')
// → { intent: 'travel', confidence: 1, entities: { origin: 'bogota', destination: 'lima' } }
```

Limits (by design): slots are single-token and the pattern is anchored to the whole
message. Two slots must be separated by a space or a word: `define()` throws on adjacent
slots such as `'{a}{b}'` (ambiguous, and slow to match on long tokens). Slots glued by
a word inside one token (`'{qty}x{item}'`) are allowed: the first slot stops at the first
character of the glue, so `3xbox` gives `qty: '3'`, `item: 'box'`. Punctuation splits words before slots are matched, so an order id such as `A-1` becomes
two words (`a 1`) and does not fill a single slot; use an utterance with two slots (`'my order {prefix} {number}'`)
or ask for the id in a conversation step. An utterance that is only a slot (`'{name}'`) matches **every** one-word
message with confidence `1`: keep it for intents that really are a catch-all. If the input doesn't line up with the pattern (extra words, different order),
the utterance still participates in normal token-overlap scoring — it just won't
extract entities.

## How matching works

1. **Normalize** both utterances and input: NFKD-decompose (full-width letters and
   ligatures fold to plain ones: `ＨＯＬＡ` → `hola`), strip accents and other
   optional diacritics (Latin accents, Hebrew points, Arabic harakat), remove invisible
   format characters (zero-width spaces, soft hyphens), lowercase, replace every character
   that is not a letter, a digit or a script's own combining mark with a space, collapse
   whitespace (`¡HOLA, SEÑOR!` → `hola senor`). Vowel signs of scripts such as
   Devanagari or Thai stay part of their word (`नमस्ते` is one word). Emoji are ignored.
2. **Score each utterance** against the input:
   - Exact normalized equality → `1`.
   - Slot utterance whose anchored regex matches the whole input → `1` (captures entities).
   - Otherwise a weighted blend of three signals:

     ```
     score = 0.3 × jaccard + 0.5 × coverage + 0.2 × contains
     ```

     - `jaccard` = `|input ∩ utterance| / |input ∪ utterance|` (the utterance's distinct words against every word of the input: a word repeated in the utterance counts once, while a word or phrase repeated in the input lowers the score, so it never reaches `1` without an exact match),
     - `coverage` = fraction of the utterance's tokens present in the input,
     - `contains` = `1` when the whole normalized utterance appears in the input as whole
       words (`my order` is in `hi my order 5`, not in `my orders`), else `0`.
3. **Best utterance wins** per intent; best intent wins overall. Results below
   `threshold` yield `null`. Matching is fully deterministic — confidence ties resolve
   to the earliest-defined intent.

What semver covers: an exact (normalized) phrase or a fully lined-up slot pattern scores `1`,
`match()` never returns a result under the threshold, and results are deterministic. The exact
scores of partial matches and the normalization details may be tuned in minor releases
(always to make matching more accurate); check `engine.rank()` after upgrading if you rely
on a threshold close to a phrase's score.

Tips for good accuracy: provide several short utterances per intent using the words
your users actually type; avoid intents that share most of their vocabulary.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| A phrase you expect never matches | Its score is under `threshold`. Check `engine.rank(text)` to see the scores, add utterances with the words your users type, or lower the threshold. |
| The wrong intent wins | Two intents share most of their words. Make their utterances more distinct, or remove the shared words from one of them. |
| A slot is not captured | Slots take **one** word and the whole message must line up with the pattern. Extra words still score through token overlap, but without `entities`. |
| `define()` throws "adjacent slots" | `'{a}{b}'` is ambiguous (and slow on long words): separate the slots with a space or a word. |
| `whenIntent` never fires but `match()` works | Another handler registered earlier caught the message (a command, an active conversation or a more specific trigger wins). See the dispatch order in the triggers guide. |
| `define()` throws "no letters or digits" | The phrase is only emoji or punctuation, which normalization removes, so it could never match. Use words (`'thumbs up'`, `'ok'`). |
| An id like `A-1` is not captured | Punctuation splits it into two words. Use two slots (`{prefix} {number}`) or ask for the id in a conversation step. |
| `ctx.tools.nlu` is `undefined` | `nluPlugin` was not plugged into this bot, or it was unplugged (unplugging removes it). |

## Links

- [Integrations guide (local intent matching)](https://andresayac.github.io/botmesh/guide/integrations#local-intent-matching-nlu) · [Triggers](https://andresayac.github.io/botmesh/guide/triggers) · [Plugins](https://andresayac.github.io/botmesh/guide/plugins) · [AI plugin](https://andresayac.github.io/botmesh/guide/ai)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/nlu/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/nlu) · [Issues](https://github.com/andresayac/botmesh/issues)
