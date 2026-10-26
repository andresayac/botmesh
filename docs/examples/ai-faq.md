# AI FAQ assistant with guardrails

A shop assistant that answers questions with an LLM, stays on topic, declines everything else and never sends a fixed answer to the model.

**Level:** Beginner · **Tags:** AI, WhatsApp, Telegram, Guardrails

**Features shown:** [AI autoresponder](/guide/ai#quickstart-autoresponder) ·
[business-scoped persona](/guide/ai#whatsapp-ai-policy-since-2026-01-15) ·
[text and function triggers](/guide/triggers) ·
[slash commands](/guide/first-bot#_2-slash-commands) ·
[`/reset` of the AI history](/guide/ai#reset-and-slashcommandsplugin) ·
[cost and latency settings](/guide/ai#cost-and-latency) ·
[terminal simulator](/guide/dev-simulator)

## Prerequisites

- Node.js 22.12 or newer.
- An Anthropic API key in the `ANTHROPIC_API_KEY` environment variable (or
  another model provider, see [below](#other-model-providers)). Never write
  the key in the code.

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

While the packages are in prerelease, add the dist-tag shown in
[Getting started](/guide/getting-started#requirements).

## The bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

// The persona is the main guardrail: one business, what to answer, what to decline.
const PERSONA = [
  'You are the assistant of Northwind Bikes, a bicycle shop with a repair workshop.',
  'Answer only about our bikes, accessories, repairs, opening hours (Mon-Sat 9:00-19:00) and orders.',
  'If the question is about anything else, say in one sentence that you can only help with Northwind Bikes',
  'and suggest typing "agent" to talk to a person.',
  'Never make up prices, stock or policies: if you do not know, say so. Answer in at most three short sentences.',
].join(' ')

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  bot.plug(slashCommandsPlugin, {
    greeting: '🚲 Hi! I am the Northwind Bikes assistant. Ask me about bikes, repairs or opening hours.',
  })

  // Fixed answers never reach the model: instant, free and always right.
  bot.when(['hours', 'opening hours'], (ctx) => ctx.reply('🕘 We are open Mon-Sat, 9:00-19:00.'))
  bot.when(['agent', 'human'], (ctx) => ctx.reply('👤 Call us at +1 555 0100 or write to help@northwind.example.'))

  // A deterministic guardrail: very long messages are not sent to the model.
  bot.when(
    (ctx) => ctx.body.length > 500,
    (ctx) => ctx.reply('✂️ That is a long message. Please ask one short question at a time.'),
  )

  // Everything else goes to the model. Plugged last, so its /reset also clears the AI history.
  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',     // a small model is enough for FAQs
    persona: PERSONA,
    maxTokens: 300,                // short answers: cheaper and faster
    context: { maxMessages: 10 },  // history sent with each question
  }))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

- **Order of handlers.** Commands, `bot.when()` triggers and flows always run
  before the AI. `aiPlugin` registers a catch-all autoresponder that only sees
  the text messages nothing else handled, so "hours" and "agent" are answered
  by your code, not by the model.
- **The persona is the guardrail.** It names one business, lists what the bot
  may talk about and says how to decline. Since January 2026 WhatsApp only
  allows AI in service of a business, never as a general-purpose assistant
  (see [WhatsApp AI policy](/guide/ai#whatsapp-ai-policy-since-2026-01-15)).
- **A deterministic guardrail.** A function trigger answers messages longer
  than 500 characters itself, so a pasted essay never becomes a paid model call.
  Add any rule you can check in code the same way.
- **Cost and latency.** `model`, `maxTokens` and `context.maxMessages` keep
  every answer small. `timeoutMs` (60 s by default) bounds each call; a failed
  call answers the built-in "⚠️ I can't answer right now…" text instead of
  crashing.
- **`/reset`.** `aiPlugin` adds its own `/reset`, which clears the chat's AI
  history. It is plugged after `slashCommandsPlugin`, so its `/reset` wins.

## Try it

```bash
npx botmesh dev bot.js --env-file .env   # .env has the line ANTHROPIC_API_KEY=sk-ant-...
```

This is a run of the code above in the terminal simulator. The AI answers come
from a scripted model in the test that runs this page
(`packages/ai/tests/docs-examples-ai.test.ts`); a real model words them
differently.

```text
user › /start
bot › 🚲 Hi! I am the Northwind Bikes assistant. Ask me about bikes, repairs or opening hours.
user › hours
bot › 🕘 We are open Mon-Sat, 9:00-19:00.
user › do you repair electric bikes?
bot › Yes, our workshop services electric bikes too: motor, battery and brakes. Bring it in Mon-Sat, 9:00-19:00.
user › write me a poem about the sea
bot › Sorry, I can only help with Northwind Bikes. Type "agent" to talk to a person.
user › agent
bot › 👤 Call us at +1 555 0100 or write to help@northwind.example.
```

## Other model providers

::: details Switch to OpenAI, Gemini or a local Ollama model
Install the SDK of the provider and change the `aiPlugin` options; the rest of
the bot stays the same.

OpenAI (`npm install openai`, key in `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA })
```

Gemini (`npm install @google/genai`, key in `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA })
```

Ollama on your machine (no package, no key; run `ollama pull llama3.1` first):

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', persona: PERSONA })
```

The full list (and the OpenAI-compatible presets) is in
[Choose a provider](/guide/ai#choose-a-provider).
:::

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR code: scan it with WhatsApp (**Linked devices**) and
write to that number from another phone. For Telegram, install
`@botmesh/telegram` and start the factory with
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })` instead (see
[Or connect Telegram](/guide/getting-started#or-connect-telegram)).

## Next steps

- [AI with tools](./ai-tools-booking): let the model book appointments, with a human confirmation
- [AI plugin guide](/guide/ai): every `aiPlugin` option
- [Examples overview](./index)
