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

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/nlu@beta` during the beta (`npm view @botmesh/nlu dist-tags` lists the tags). Once stable, the plain command above works.

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
| `intents` | `Record<string, string[]>` | — | `nluPlugin` only: intents to define at install, `{ name: [utterance, …] }`. |

## API

| Member | Description |
| --- | --- |
| `engine.define(intent, utterances)` | Adds example phrases to an intent (chainable). Calling it again for the same intent **appends**. Throws on an empty name or an empty list. |
| `engine.match(text, threshold?)` | The best intent at or above the threshold, or `null`. The per-call threshold follows the same rule as the option. |
| `engine.rank(text)` | Every intent with a positive score, best first. Useful for debugging and "did you mean…?" menus. |
| `engine.intents()` / `engine.threshold` | Intent names in definition order, and the configured threshold. |
| `nluPlugin` | Installs an engine as `ctx.tools.nlu` (typed by importing the package; `bot.injectTools.nlu` outside handlers). |
| `whenIntent(bot, engine, intent, handler)` | Runs `handler(ctx, match)` only when the text's **best** match is `intent`. Returns an unsubscribe function, like `bot.when`. |
| `normalizeText(text)` | The normalization the engine applies (accents, case and punctuation removed, whitespace collapsed). |

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
character of the glue, so `3xbox` gives `qty: '3'`, `item: 'box'`. If the input doesn't line up with the pattern (extra words, different order),
the utterance still participates in normal token-overlap scoring — it just won't
extract entities.

## How matching works

1. **Normalize** both utterances and input: NFD-decompose and strip diacritics,
   lowercase, replace every non-alphanumeric character with a space, collapse
   whitespace (`¡HOLA, SEÑOR!` → `hola senor`).
2. **Score each utterance** against the input:
   - Exact normalized equality → `1`.
   - Slot utterance whose anchored regex matches the whole input → `1` (captures entities).
   - Otherwise a weighted blend of three signals:

     ```
     score = 0.3 × jaccard + 0.5 × coverage + 0.2 × contains
     ```

     - `jaccard` = `|input ∩ utterance| / |input ∪ utterance|` (bag-of-tokens overlap),
     - `coverage` = fraction of the utterance's tokens present in the input,
     - `contains` = `1` when the whole normalized utterance appears as a substring of
       the input, else `0`.
3. **Best utterance wins** per intent; best intent wins overall. Results below
   `threshold` yield `null`. Matching is fully deterministic — confidence ties resolve
   to the earliest-defined intent.

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
| `ctx.tools.nlu` is `undefined` | `nluPlugin` was not plugged into this bot. |

## Links

- [Integrations guide (local intent matching)](https://andresayac.github.io/botmesh/guide/integrations#local-intent-matching-nlu) · [Triggers](https://andresayac.github.io/botmesh/guide/triggers) · [Plugins](https://andresayac.github.io/botmesh/guide/plugins) · [AI plugin](https://andresayac.github.io/botmesh/guide/ai)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/nlu/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/nlu) · [Issues](https://github.com/andresayac/botmesh/issues)
