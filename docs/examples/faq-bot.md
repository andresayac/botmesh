# FAQ Bot

Build a bot that answers frequent questions from keywords, whatever the
casing or accents, and says so when it does not know.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Triggers

**Features shown:** [text triggers with normalized matching](/guide/concepts#when-simple-responses) ·
[keyword lists](/guide/concepts#when-simple-responses) ·
[`contains` matching](/guide/concepts#when-simple-responses) ·
[regex triggers](/guide/concepts#when-simple-responses) ·
[trigger precedence](/guide/triggers#precedence) ·
[catch-all](/guide/concepts#message-event-vs-onmessage)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements), which also explains
the prerelease tags). Then install:

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Each answer with the phrases that lead to it
const FAQ = [
  { ask: ['hours', 'opening hours', 'when are you open'], answer: '🕘 Monday to Saturday, 9:00 to 19:00.' },
  { ask: ['address', 'where are you', 'location'], answer: '📍 42 Baker Street, downtown.' },
  { ask: ['prices', 'price', 'how much'], answer: '💲 Coffee $2 · Cake $4 · Combo $5' },
]

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // Whole-message match, normalized: "HOURS", "Hours " and "hóurs" all match 'hours'
  for (const { ask, answer } of FAQ) bot.when(ask, (ctx) => ctx.reply(answer))

  bot.when(['help', 'faq', 'menu'], (ctx) =>
    ctx.reply('❓ Ask me about: hours · address · prices · delivery\nOr send an order number like #1234.'),
  )

  // `contains`: the word anywhere in the message
  bot.when({ pattern: 'delivery', match: 'contains' }, (ctx) =>
    ctx.reply('🛵 We deliver within 3 km. Orders over $10 ship free.'),
  )

  // A regex: an order number such as #1234
  bot.when(/#\d{4,}/, (ctx) => ctx.reply(`📦 Order ${/#\d{4,}/.exec(ctx.body)[0]} is on its way.`))

  // Runs only when no trigger above matched
  bot.onMessage((ctx) => ctx.reply('🤷 I do not know that one yet. Send "help" to see the topics.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "help" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`:

```text
user › help
bot › ❓ Ask me about: hours · address · prices · delivery
      Or send an order number like #1234.
user › HÓURS
bot › 🕘 Monday to Saturday, 9:00 to 19:00.
user › where are you
bot › 📍 42 Baker Street, downtown.
user › Where are you?
bot › 🤷 I do not know that one yet. Send "help" to see the topics.
user › do you have delivery to my area
bot › 🛵 We deliver within 3 km. Orders over $10 ship free.
user › any news about #20931?
bot › 📦 Order #20931 is on its way.
user › hours please
bot › 🤷 I do not know that one yet. Send "help" to see the topics.
```

## How it works

- **Normalized equality.** A string trigger matches the **whole** message
  after lowercasing, stripping accents and collapsing spaces, so "HÓURS"
  matches `hours`, but "hours please" does not: it falls to the catch-all.
  That keeps short keywords from firing inside unrelated sentences.
- **Punctuation counts.** "Where are you?" is not "where are you", so the
  catch-all answers it. Add the variant to the list (`'where are you?'`)
  or use a regex such as `/^where are you\??$/i` when users type it.
- **Lists.** `bot.when(['hours', 'opening hours'], ...)` matches any entry;
  the loop registers one handler per FAQ entry.
- **`contains`.** `{ pattern: 'delivery', match: 'contains' }` matches the
  word anywhere; `startsWith` and `endsWith` exist too.
- **Regex.** `/#\d{4,}/` finds an order number in any sentence.
- **Precedence.** When several triggers match, the most specific wins:
  plain text, then `startsWith`, `endsWith`, regex, `contains`, and the
  catch-all last.

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Menu bot](./menu-bot): guide the user with a numbered menu instead of keywords
- [Special triggers](/guide/triggers): react to images, locations or calls
- [AI plugin](/guide/ai): answer free-form questions with a model
