# AI answers from your own FAQ (RAG)

A support bot that answers from a Markdown FAQ you write, cites the section it used and says so when the FAQ has no answer.

**Level:** Intermediate · **Tags:** AI, RAG, WhatsApp, Telegram

**Features shown:** [RAG with any retriever](/guide/ai-memory-rag#rag) ·
[`appendSources` citations](/guide/ai-memory-rag#rag) ·
[retriever `warmup()` at startup](/guide/ai-memory-rag#rag) ·
[AI autoresponder](/guide/ai#quickstart-autoresponder) ·
[cost and latency settings](/guide/ai#cost-and-latency)

## Prerequisites

- Node.js 22.12 or newer.
- An Anthropic API key in the `ANTHROPIC_API_KEY` environment variable (or
  another model provider, see [below](#other-model-providers)).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

While the packages are in prerelease, add the dist-tag shown in
[Getting started](/guide/getting-started#requirements).

## Your FAQ

Save it as `faq.md` next to `bot.js`. Each `## ` section becomes one passage
the model can cite.

```md
<!-- faq.md -->
# Lumen Lamps FAQ

## Shipping
We ship nationwide. Orders arrive in 2-3 business days; express shipping arrives the next business day.

## Returns
You can return any lamp within 30 days of delivery, unused and in its box. Refunds take 5 business days.

## Payments
We accept credit and debit cards, PayPal and bank transfer.

## Warranty
Every lamp has a 2-year warranty against manufacturing defects.
```

## The bot

```js
// bot.js
import { readFile } from 'node:fs/promises'
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

const STOP_WORDS = new Set(['the', 'and', 'you', 'your', 'for', 'with', 'how', 'what', 'does', 'can', 'are', 'our', 'after'])
const words = (text) =>
  new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)))

/**
 * A small retriever over a Markdown file: one passage per `## ` section, ranked by the
 * words it shares with the question. The plugin only needs `retrieve(query)`, so a
 * vector database or a search API fits in the same place.
 */
function markdownRetriever(file) {
  let sections
  const load = async () => {
    sections ??= (await readFile(file, 'utf8'))
      .split(/^## /m)
      .slice(1)
      .map((part) => {
        const [title, ...body] = part.trim().split('\n')
        const text = body.join('\n').trim()
        return { title, text, words: words(`${title} ${text}`) }
      })
    return sections
  }
  return {
    warmup: async () => { await load() }, // aiPlugin calls it at startup
    async retrieve(query, { topK = 2 } = {}) {
      const asked = words(query)
      return (await load())
        .map((s) => ({ ...s, score: [...asked].filter((w) => s.words.has(w)).length }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => ({ text: s.text, citation: `faq.md › ${s.title}`, score: s.score }))
    },
  }
}

const PERSONA = [
  'You are the support assistant of Lumen Lamps, an online lamp store.',
  'Answer only with the information of the context. If it does not have the answer,',
  'say you do not know and suggest writing to help@lumen.example. Answer in one or two sentences.',
].join(' ')

const RAG = {
  retriever: markdownRetriever(new URL('./faq.md', import.meta.url)),
  topK: 2,              // fewer passages, shorter prompt
  appendSources: true,  // adds "Sources: [1] faq.md › Shipping" to the answer
}

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',
    persona: PERSONA,
    maxTokens: 300,
    rag: RAG,
  }))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-rag-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

- **Retrieval on every turn.** Before each answer the plugin calls
  `retrieve(question)` and adds the passages to the system prompt as a
  numbered block, with instructions to answer from them, cite them as `[n]`
  and treat them as data, not instructions.
- **Citations.** With `appendSources: true` the reply ends with the sources
  the model cited. When nothing matches, no passage is sent and the persona
  makes the model say it does not know instead of guessing.
- **Never fails a reply.** If the retriever throws or takes longer than
  `timeoutMs` (10 s by default), the turn goes on without context.
- **Startup.** `warmup()` reads the file when the bot starts, so the first
  question does not wait for it.
- **Bigger knowledge bases.** Replace `markdownRetriever` with a call to your
  vector database or search API: any object with `retrieve(query)` that
  resolves `{ text, citation?, score? }` passages works.

::: info Ready-made retriever: `@botmesh/rag`
The `@botmesh/rag` package has loaders
(Markdown, text, JSON, PDF), chunking, embeddings (local, OpenAI or Ollama) and
a persisted index: `rag: { retriever: createRag({ documents: ['./faq.md'] }), appendSources: true }`.
Install it with `npm install @botmesh/rag`; see
[`@botmesh/rag`](/guide/ai-memory-rag#botmesh-rag).
:::

## Try it

```bash
npx botmesh dev bot.js --env-file .env   # .env has the line ANTHROPIC_API_KEY=sk-ant-...
```

A run of the code above in the terminal simulator, with `faq.md` next to it.
The model is scripted by the test that runs this page
(`packages/ai/tests/docs-examples-ai.test.ts`), which also checks that the right
FAQ section reached the model; the retrieval and the sources line are real.

```text
user › how long does shipping take?
bot › Orders arrive in 2-3 business days, or the next business day with express shipping [1].

      Sources: [1] faq.md › Shipping
user › do you sell desk fans?
bot › Sorry, I do not know that. Please write to help@lumen.example.
user › can I return a lamp after two weeks?
bot › Yes: you can return a lamp within 30 days of delivery, unused and in its box [1].

      Sources: [1] faq.md › Returns
```

## Other model providers

::: details Switch to OpenAI, Gemini or a local Ollama model
Only the provider options change; `rag` stays the same.

OpenAI (`npm install openai`, key in `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA, rag: RAG })
```

Gemini (`npm install @google/genai`, key in `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA, rag: RAG })
```

Ollama on your machine (no package, no key; run `ollama pull llama3.1` first):

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', persona: PERSONA, rag: RAG })
```
:::

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR code: scan it with WhatsApp (**Linked devices**).
For Telegram, install `@botmesh/telegram` and start the factory with
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`.

## Next steps

- [AI memory & RAG guide](/guide/ai-memory-rag): every `rag` option, and per-user memory
- [AI router](./ai-router): send payments to a deterministic flow and the rest to the AI
- [Examples overview](./index)
