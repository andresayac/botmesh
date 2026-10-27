# Streaming AI replies on Telegram

A cooking assistant on Telegram whose answers appear while the model writes them, tuned for cost and latency.

**Level:** Intermediate · **Tags:** AI, Streaming, Telegram, Performance

**Features shown:** [streaming autoreply (`stream`)](/guide/streaming#with-botmesh-ai) ·
[strategies per channel: drafts, edits, chunks](/guide/streaming#strategies-per-channel) ·
["typing…" while generating](/guide/ai#full-aiplugin-config-reference) ·
[Telegram provider](/guide/getting-started#or-connect-telegram) ·
[cost and latency settings](/guide/ai#cost-and-latency) ·
[testing streams with `MockProvider`](/guide/streaming#testing)

## Prerequisites

- Node.js 22.12 or newer.
- A Telegram bot token from [@BotFather](https://t.me/BotFather) in
  `TELEGRAM_TOKEN`.
- An Anthropic API key in `ANTHROPIC_API_KEY` (or another model provider, see
  [below](#other-model-providers)).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/telegram
```

## The bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { TelegramProvider } from '@botmesh/telegram'
import { aiPlugin } from '@botmesh/ai'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  bot.plug(slashCommandsPlugin, {
    greeting: '🍳 Hi! I am the Pantry cooking assistant. Ask me for a recipe or a cooking tip.',
  })

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',      // small model: first words arrive sooner, each token costs less
    persona: 'You are the cooking assistant of the Pantry recipe app. Only talk about cooking. Use short paragraphs.',
    maxTokens: 800,                 // caps the length (and the bill) of each answer
    timeoutMs: 20_000,              // with streaming: the longest silence allowed between two chunks
    context: { maxMessages: 6 },    // less history per call: a shorter, cheaper prompt
    stream: { cursor: ' ▌', canStop: true },
  }))

  return bot
})

export default createBot

// `node --env-file=.env bot.js` connects to Telegram; `npx botmesh dev bot.js` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' }))
  bot.on('ready', () => console.log('✅ Connected. Write to your bot in Telegram.'))
  await bot.start()
}
```

## How it works

- **One option.** `stream` makes the autoresponder send the answer with
  [`ctx.stream()`](/guide/streaming) while the model generates it. The same
  code picks the best strategy for each channel:

  | Channel | What the user sees |
  | --- | --- |
  | Telegram private chat | A native draft that grows in place (`sendMessageDraft`), then the final message |
  | Telegram group, Discord | One message edited as the text arrives |
  | WhatsApp, Messenger, Instagram, the simulator | Sentence-sized messages with "typing…" in between |

- **`cursor`** is shown at the end of the text while it is being written and
  never in the final message. **`canStop`** adds Telegram's stop button to the
  draft: pressing it aborts the model request, so you stop paying for it.
- **Typing.** `humanizeTyping` (on by default) shows "typing…" until the first
  words arrive.
- **Tools turn streaming off.** A turn that may call [tools](/guide/ai-tools)
  needs the whole answer first, so with `tools` configured the reply is sent
  in one message.

## Cost and latency tips

| Setting | Effect |
| --- | --- |
| `model` | The biggest lever. A small model (`claude-haiku-5-5`, `gpt-5-mini`, `gemini-3.8-flash`) answers sooner and costs a fraction of a large one. |
| `maxTokens` | Caps each answer. It includes the thinking tokens of reasoning models: too low and the answer comes out empty. |
| `timeoutMs` | Without streaming, the total time for a call; with streaming, the longest pause between chunks, so a long answer is never cut while it keeps flowing. |
| `context.maxMessages` | Every turn resends the history window: fewer messages, shorter prompt. |
| `effort` (Anthropic) | `'low'` thinks less: faster and cheaper on simple questions. |
| `stream` | Does not lower the cost, but the first words show in about a second instead of after the whole answer. |

Answer the obvious without the model (commands, `bot.when()` triggers,
flows), and see [Cost and latency](/guide/ai#cost-and-latency) for the rest.

## Try it

```bash
npx botmesh dev bot.js --env-file .env   # .env has the line ANTHROPIC_API_KEY=sk-ant-...
```

The simulator has no drafts or edits, so it shows the "chunk" strategy that
WhatsApp uses: the answer arrives as sentence-sized messages. This run is
scripted by the test that runs this page
(`packages/ai/tests/docs-examples-ai.test.ts`), which also runs the bot on a
mock Telegram-like provider and checks that the answer arrives as a growing
draft there.

```text
user › how do I make a quick tomato soup?
bot › Sauté a chopped onion and two garlic cloves in olive oil for five minutes. Add a 400 g can of crushed tomatoes, a cup of stock, salt and a pinch of sugar, and simmer for 15 minutes.
bot › Blend until smooth, then finish with fresh basil and a splash of cream. Serve it hot with toasted bread.
```

## Other model providers

::: details Switch to OpenAI, Gemini or a local Ollama model
Every provider streams. Keep the other options as they are.

OpenAI (`npm install openai`, key in `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', stream: true })
```

Gemini (`npm install @google/genai`, key in `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', stream: true })
```

Ollama on your machine (no package, no key; run `ollama pull llama3.1` first):
the first token arrives with no network round trip, and there is no output cap
unless you set `maxTokens`.

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', stream: true })
```
:::

## Run it on Telegram or WhatsApp

Put the token and the key in a `.env` file next to `bot.js`
(`TELEGRAM_TOKEN=...` and `ANTHROPIC_API_KEY=...`), run
`node --env-file=.env bot.js` and write to your bot in Telegram. For WhatsApp,
install `@botmesh/baileys` and start the factory with
`new BaileysProvider({ session: 'pantry-bot' })` instead: the same code sends
the answer in chunks with "typing…".

## Next steps

- [Streaming replies](/guide/streaming): `ctx.stream()` for your own handlers and every option
- [AI FAQ assistant](./ai-faq): the persona and guardrails of a business assistant
- [Examples overview](./index)
