# @botmesh/ai

AI plugin for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core):
answer your users with Anthropic, OpenAI, Gemini, Ollama (local or cloud) or
nine OpenAI-compatible services, on any channel. One
`bot.plug(aiPlugin(...))` gives you a catch-all autoresponder with per-chat
history and `ctx.tools.ai`, a client for your own handlers, flows and
conversations. Tool calling with human confirmation, long-term memory, RAG and
streaming are built in.

Full guide: <https://andresayac.github.io/botmesh/guide/ai>
(español: <https://andresayac.github.io/botmesh/es/guide/ai>).

## Installation

```bash
pnpm add @botmesh/core @botmesh/ai @botmesh/baileys @anthropic-ai/sdk
```

`@botmesh/baileys` is the channel used in the Quickstart (swap it for yours,
e.g. `@botmesh/meta` or `@botmesh/telegram`); the last package is the SDK of
your AI provider (see [Providers](#providers)).
Requires **Node >= 22**.

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older alpha. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/ai@beta` during the beta (`npm view @botmesh/ai dist-tags` lists the tags). Once stable, the plain command above works.

## Quickstart

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }) })

// Persona scoped to the business (see "WhatsApp AI policy" below).
const persona = [
  'You are the customer-support assistant of La Espiga Bakery.',
  'You only answer about its products, prices, opening hours (Mon-Sat 7:00-20:00), orders and pre-orders.',
  'If asked about anything unrelated to the bakery, politely say you can only help with that',
  'and offer to hand the chat over to a person. Answer briefly; never make up facts.',
].join(' ')

bot.plug(aiPlugin({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  persona,
}))

await bot.start()
```

This registers:

- A catch-all autoresponder that answers any **text** message no command,
  trigger or conversation consumed, keeping a per-chat history window
  (20 messages by default, `context.maxMessages`).
- A `/reset` command that clears the chat's AI history and cancels its active
  conversation (`resetCommand: false` turns it off). If you also use
  `slashCommandsPlugin`, plug `aiPlugin` after it so this `/reset` wins.

The built-in replies (errors, tool confirmations) are in English; a bot with
`lang: 'es'` gets them in Spanish.

## WhatsApp AI policy (since 2026-01-15)

Since **January 15, 2026**, Meta's terms for the **WhatsApp Business
Platform** forbid **general-purpose AI assistants** (open ChatGPT-style
chatbots whose main purpose is the AI itself). AI **in service of the
business** (support, sales, bookings, order tracking) is still allowed. Write
a `persona` scoped to your business that declines anything unrelated, offer a
way to reach a human, and check the
[current terms](https://www.whatsapp.com/legal/business-solution-terms)
before going live. This is practical guidance, not legal advice.

## Providers

| `provider` | Install | API key | Default model |
|---|---|---|---|
| `anthropic` (default) | `@anthropic-ai/sdk` | `apiKey` or `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| `openai` | `openai` | `apiKey` or `OPENAI_API_KEY` | none: set `model` |
| `gemini` | `@google/genai` | `apiKey`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.8-flash` |
| `ollama` | nothing (plain `fetch`) | none (local); `apiKey` for the cloud API | none: set `model` |
| `deepseek`, `qwen`, `glm`, `kimi`, `groq`, `openrouter`, `mistral`, `grok`, `together` | `openai` | each preset's env var (`DEEPSEEK_API_KEY`, `GROQ_API_KEY`…) | per preset |

```ts
aiPlugin({ provider: 'openai', model: 'gpt-5.1' })            // OPENAI_API_KEY
aiPlugin({ provider: 'gemini' })                              // GEMINI_API_KEY
aiPlugin({ provider: 'ollama', model: 'llama3.1' })           // http://localhost:11434
aiPlugin({ provider: 'deepseek' })                            // DEEPSEEK_API_KEY, deepseek-chat
```

- `baseUrl` points `openai` at Azure OpenAI or any OpenAI-compatible server
  (vLLM, LM Studio, a gateway), and `ollama` at another host.
- **Ollama cloud models**: sign in your local Ollama (`ollama signin`) and use
  a `-cloud` model name; or call `https://ollama.com` directly with
  `baseUrl: 'https://ollama.com'` and `apiKey` (sent as `Authorization: Bearer`; see the
  [guide](https://andresayac.github.io/botmesh/guide/ai#ollama-local-or-cloud)).
- **Vertex AI**: `aiPlugin({ instance: new GeminiProvider(fromGoogleGenAI(new GoogleGenAI({ vertexai: true, project, location })), { model }) })`.
- The SDKs are optional peers, loaded only when used: `@anthropic-ai/sdk`
  `^0.68.0 || ^1.0.0`, `openai` `^6.48.0 || ^7.0.0`, `@google/genai` `^2.0.0`
  (the deprecated `@google/generative-ai` `^0.21.0` to `^0.24.0` still works).
- Default models follow each vendor's current models and are **not covered by
  semver**. Set `model` when the choice matters.

## `ctx.tools.ai`

The plugin also injects an `AIClient` as `ctx.tools.ai` (typed, no casts).
Set `autoReply: false` if you only want the client:

```ts
bot.plug(aiPlugin({ provider: 'anthropic', autoReply: false }))

bot.conversation('complaint', async (c, ctx) => {
  await ctx.reply('📝 Tell us what went wrong with your order:')
  const text = await c.waitText()
  const summary = await ctx.tools.ai.ask(`Summarize this customer complaint in 3 lines: ${text}`)
  await ctx.reply(`✅ We logged your complaint:\n${summary}`)
})
```

| Method | What it does |
|---|---|
| `ask(prompt)` | One-shot question, without chat history. |
| `replyInChat(chatKeyOf(ctx), text, opts?)` | Answers inside the chat's history, like the autoresponder. `replyInChatDetailed()` also returns citations and facts. |
| `streamReplyInChat(...)` | The streaming twin, for `ctx.stream()`. |
| `runTools(input, opts?)` | Runs the tool loop and returns its full result. |
| `generate(input)` / `stream(input)` | Full control: explicit messages and per-call overrides. |
| `memory()`, `remember()`, `forget()`… | Long-term memory per user. |

## Tool calling

The model can call your functions through each provider's native tool
calling, in a loop with argument validation (JSON Schema or any `safeParse()`
validator such as zod), per-tool timeouts, errors fed back to the model and
audit events (`bot.on('ai.tool')`). Tools with `confirm: true` ask the user
first (Yes/No buttons where the channel has them) without blocking the chat.

```ts
import { aiPlugin, defineTool } from '@botmesh/ai'

bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',
  tools: {
    search_product: {
      description: 'Search the catalog by text',
      schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      handler: async ({ q }: { q: string }) => db.products.search(q),
    },
    place_order: defineTool<{ product: 'rye_bread' | 'croissant'; quantity: number }>({
      title: 'Place order',  // shown to the user in the confirmation
      description: 'Place an order for the customer',
      schema: {
        type: 'object',
        properties: { product: { type: 'string', enum: ['rye_bread', 'croissant'] }, quantity: { type: 'integer', minimum: 1 } },
        required: ['product', 'quantity'],
      },
      confirm: true,          // "About to: Place order … Do you confirm?"
      dedupe: 'args',         // never place the very same order twice in a row
      handler: async (args, { ctx }) => db.orders.create({ ...args, chat: ctx?.from }),
    }),
  },
}))
```

Best practices for side-effecting tools (money computed in code, `enum` for
catalog keys, update/cancel/list tools next to create):
<https://andresayac.github.io/botmesh/guide/ai-tools>.

## Memory, RAG and streaming

```ts
bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',
  memory: { autoExtract: true, ttl: '90d' },     // per-user facts, stored in ctx.user
  rag: { retriever: myRetriever, appendSources: true }, // any { retrieve(query) }
  stream: true,                                    // drafts / live edits / sentence chunks
}))
```

- **Memory** keeps short facts about each person across conversations and
  restarts (in the persistent user profile), injects them into the
  autoreply, and is not injected in groups unless you allow it.
- **RAG** takes any retriever (`retrieve(query)` resolving `{ text, citation? }`
  passages): the passages are injected numbered and the model cites them as
  `[n]`.
- **Streaming** sends the autoreply while it is generated; turns with tools
  are not streamed.

Guide: <https://andresayac.github.io/botmesh/guide/ai-memory-rag>.

## Errors

A misconfigured provider (SDK not installed, unknown provider, missing key)
never crashes the process: the problem is logged at startup and each message
gets the `errorMessage` reply. A configuration that can never work (a `NaN`
timeout, a non-integer `maxTokens`, a tool without `handler`) throws from
`aiPlugin()`. `bot.stop()` aborts every model call in flight, and a call over
`timeoutMs` (60 s by default) rejects with `AITimeoutError`. Troubleshooting
table: <https://andresayac.github.io/botmesh/guide/ai#errors-and-troubleshooting>.

## Testing

`MockAIProvider` (from `@botmesh/ai/testing`) answers with fixed or scripted
replies, with no network:

```ts
import { AIClient, ContextManager, type ConvStore, type AIMessage } from '@botmesh/ai'
import { MockAIProvider } from '@botmesh/ai/testing'

const memory = new Map<string, AIMessage[]>()
const store: ConvStore = {
  async getConversation(k) { return memory.get(k) },
  async setConversation(k, m) { memory.set(k, m) },
  async clearConversation(k) { memory.delete(k) },
}

const client = new AIClient(new MockAIProvider({ reply: 'hello from the mock' }), new ContextManager(store))

const answer = await client.ask('what time is it?')
// answer === 'hello from the mock'
```

Inside a test bot, pass it to the plugin: `aiPlugin({ instance: new MockAIProvider({ reply: '...' }) })`.
`reply` can be a function that returns `{ toolCalls }` to script tool calls,
and `mock.calls` records every request.

## Entry points

| Entry | Contents | Semver |
|---|---|---|
| `@botmesh/ai` | `aiPlugin`, `AIClient`, the providers and client contracts, tools, memory and RAG types, `formatMarkdown` | yes |
| `@botmesh/ai/testing` | `MockAIProvider`, `validateArgs` | yes |
| `@botmesh/ai/internal` | Plugin helpers and SDK wire type names | no |

## More documentation

- AI plugin guide: <https://andresayac.github.io/botmesh/guide/ai>
- Tool calling: <https://andresayac.github.io/botmesh/guide/ai-tools>
- Memory and RAG: <https://andresayac.github.io/botmesh/guide/ai-memory-rag>
- Streaming: <https://andresayac.github.io/botmesh/guide/streaming>
- Source and issues: <https://github.com/andresayac/botmesh>

## License

MIT
