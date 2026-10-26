# AI plugin

`@botmesh/ai` answers your users with a large language model. One
`bot.plug(aiPlugin(...))` gives you:

- an **autoresponder** for every text message your commands, triggers and
  flows did not handle, with a per-chat history;
- **`ctx.tools.ai`**, a client you call from your own handlers, flows and
  conversations;
- optional [tool calling](/guide/ai-tools), [long-term memory and RAG](/guide/ai-memory-rag)
  and [streaming](/guide/streaming#with-botmesh-ai).

It works with Anthropic, OpenAI, Gemini, Ollama (local or cloud) and nine
OpenAI-compatible services, on every channel.

::: tip Separate package
Unlike `slashCommandsPlugin` (bundled with the core), `@botmesh/ai` is its own
package, so a bot without AI carries no AI dependencies. The provider SDKs are
optional and loaded only when used.
:::

## Quickstart (autoresponder)

Install the plugin and the SDK of your provider (here Anthropic, the default):

```bash
pnpm add @botmesh/ai @anthropic-ai/sdk
```

While the packages are in prerelease, add the dist-tag shown in
[Getting started](/guide/getting-started).

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }) })

// Business-scoped persona (see "WhatsApp AI policy" below).
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

- A catch-all autoresponder (`bot.onMessage`) that answers any **text**
  message no command, trigger or conversation consumed. It keeps a per-chat
  history window (20 messages by default, `context.maxMessages`) in the bot's
  store.
- A `/reset` command that clears the chat's AI history and cancels its active
  conversation (turn it off with `resetCommand: false`).

Your own handlers always run first: the autoresponder only sees what is left.

## WhatsApp AI policy (since 2026-01-15)

::: warning General-purpose AI assistants are not allowed on the WhatsApp Business Platform
Since **January 15, 2026**, Meta's terms for the WhatsApp Business Platform
(the *AI Providers* section) **prohibit general-purpose AI assistants**:
open-ended, ChatGPT-style chatbots whose main purpose is the AI itself.
Using AI **in service of the business** (customer support, sales, bookings,
order tracking) is still allowed.
:::

What that means for `aiPlugin`:

- Write a `persona` **scoped to your business** (what you sell, opening
  hours, policies) that politely declines anything unrelated, as in the
  [quickstart](#quickstart-autoresponder).
- Offer a way to reach a human ([handoff](/guide/handoff)) and don't market
  the bot as an "ask me anything" assistant.
- The rule comes from the official Cloud API terms (`@botmesh/meta`). Baileys
  is an unofficial WhatsApp Web client and is also subject to WhatsApp's
  terms.

This is practical guidance, not legal advice: check the
[current terms](https://www.whatsapp.com/legal/business-solution-terms)
before going live.

## Choose a provider

| `provider` | Install | API key | Default model | Notes |
|---|---|---|---|---|
| `anthropic` (default) | `@anthropic-ai/sdk` | `apiKey` or `ANTHROPIC_API_KEY` | `claude-opus-5-5` | [Thinking](#thinking-anthropic) and `effort` |
| `openai` | `openai` | `apiKey` or `OPENAI_API_KEY` | none: set `model` | Also Azure OpenAI and OpenAI-compatible servers (`baseUrl`) |
| `gemini` | `@google/genai` | `apiKey`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.8-flash` | Vertex AI through `instance` |
| `ollama` | nothing (plain `fetch`) | none (local) | none: set `model` | Local server, or Ollama's cloud models |
| `deepseek`, `qwen`, `glm`, `kimi`, `groq`, `openrouter`, `mistral`, `grok`, `together` | `openai` | each preset's env var ([table](#presets)) | per preset | OpenAI-compatible endpoints |

Every provider supports tool calling (on Ollama and the presets, when the
model does) and streaming.

::: info Default models are not covered by semver
Providers retire models on their own schedule, so the default models follow the
current ones and can change in a minor release. Set `model` explicitly when the
choice matters to you (cost, latency, output style).
:::

### Anthropic (default)

```ts
bot.plug(aiPlugin({
  provider: 'anthropic',                     // optional, it's the default
  apiKey: process.env.ANTHROPIC_API_KEY,     // or let the SDK read ANTHROPIC_API_KEY
  model: 'claude-sonnet-5-5',                // default: claude-opus-5-5
}))
```

`baseUrl` points the SDK at a gateway or proxy. For high-volume chat a smaller
model (`claude-sonnet-5-5`, `claude-haiku-5-5`) is cheaper and faster.

### OpenAI

```ts
bot.plug(aiPlugin({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-5.1',   // required: OpenAI has no default model
}))
```

`baseUrl` targets any OpenAI-compatible server (vLLM, LM Studio, a gateway) or
Azure OpenAI. The output-token cap is sent as `max_completion_tokens` to OpenAI
itself and to Azure OpenAI (`api.openai.com`, `*.openai.azure.com`,
`*.cognitiveservices.azure.com`, or `*.services.ai.azure.com` under
`/openai`), and as `max_tokens` to any other `baseUrl`, which is what those
servers expect. `maxTokensField` overrides the choice, for example for a proxy
in front of OpenAI:

```ts
aiPlugin({ provider: 'openai', baseUrl: 'https://my-proxy.example/v1', model: 'gpt-5.1', maxTokensField: 'max_completion_tokens' })
```

### Gemini

Install `@google/genai`. The older `@google/generative-ai` SDK is deprecated by
Google; it is still used when `@google/genai` is missing, with a one-time
`DeprecationWarning`. `baseUrl` becomes the SDK's `httpOptions.baseUrl`.

```ts
bot.plug(aiPlugin({
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY,  // or set GEMINI_API_KEY / GOOGLE_API_KEY and omit it
  // model: 'gemini-3.8-flash',        // default
}))
```

For Vertex AI, or any client option `aiPlugin` does not expose, build the
provider yourself and pass it as `instance`:

```ts
import { GoogleGenAI } from '@google/genai'
import { GeminiProvider, aiPlugin, fromGoogleGenAI } from '@botmesh/ai'

const ai = new GoogleGenAI({ vertexai: true, project: 'my-project', location: 'global' })
bot.plug(aiPlugin({ instance: new GeminiProvider(fromGoogleGenAI(ai), { model: 'gemini-3.8-flash' }) }))
```

### Ollama (local or cloud)

[Ollama](https://ollama.com) runs open models on your own machine. No SDK and
no API key: the plugin talks to its HTTP API with `fetch`.

```bash
ollama pull llama3.1      # once
ollama serve              # if the desktop app is not already running it
```

```ts
bot.plug(aiPlugin({
  provider: 'ollama',
  model: 'llama3.1',                   // required: Ollama has no default model
  // baseUrl: 'http://localhost:11434', // default; point it at another host if needed
}))
```

- **Tool calling** needs a model trained for it (Llama 3.1+, Qwen 3, Mistral
  and the others tagged *tools* in the Ollama library).
- **No output cap by default**: `maxTokens` is sent as `options.num_predict`
  only when you set it, so thinking models are not cut off mid-reasoning.
- **Cloud models through your local Ollama**: sign in once
  (`ollama signin`) and use a cloud model name (the ones ending in `-cloud`,
  such as `gpt-oss:120b-cloud`) with the same config. Ollama forwards the
  request to its cloud; your bot still talks to `localhost`.
- **Ollama's cloud API directly** (no local server) needs an
  `Authorization` header, which the `ollama` provider does not build from
  `apiKey`. Pass a `fetch` that adds it:

  ```ts
  import { OllamaProvider, aiPlugin } from '@botmesh/ai'

  const withKey: typeof fetch = (url, init) => fetch(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${process.env.OLLAMA_API_KEY}` },
  })

  bot.plug(aiPlugin({
    instance: new OllamaProvider({ baseUrl: 'https://ollama.com', model: 'gpt-oss:120b' }, withKey),
    persona,
  }))
  ```

### Presets

DeepSeek, Qwen, GLM, Kimi, Groq, OpenRouter, Mistral, Grok and Together are
OpenAI-compatible: the plugin reaches them through the `openai` SDK with their
own base URL, so `openai` is the only package to install. Each preset has a
default model and reads its key from its usual environment variable:

```ts
bot.plug(aiPlugin({ provider: 'deepseek' }))  // DEEPSEEK_API_KEY, model deepseek-chat
bot.plug(aiPlugin({ provider: 'groq', model: 'llama-3.3-70b-versatile' }))
```

| Preset | Env var | Default model |
|---|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| `qwen` | `DASHSCOPE_API_KEY` | `qwen-plus` |
| `glm` | `ZHIPUAI_API_KEY` | `glm-5.3` |
| `kimi` | `MOONSHOT_API_KEY` | `moonshot-v1-8k` |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| `grok` | `XAI_API_KEY` | `grok-4.7` |
| `together` | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |

`apiKey`, `model` and `baseUrl` override the preset's values.

### Supported SDK versions

The SDKs are optional peer dependencies; install only the one your provider
needs.

| SDK | Accepted versions | Tested |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.68.0 \|\| ^1.0.0` | 0.68.0 and 1.x |
| `openai` | `^6.48.0 \|\| ^7.0.0` | 6.48.0 and 7.x |
| `@google/genai` | `^2.0.0` | 2.0.0 and 2.x |
| `@google/generative-ai` (deprecated) | `^0.21.0` to `^0.24.0` | 0.24 |

The tests drive each SDK at both ends of its range against a local fake of the
HTTP API: plain replies, tool calls with their results, and streaming.

## Use the AI from your code: `ctx.tools.ai`

The plugin also does `bot.provide('ai', client)`, so `ctx.tools.ai` is
available in any handler, flow or conversation. Turn the autoresponder off
(`autoReply: false`) if that is all you want:

```ts
bot.plug(aiPlugin({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  autoReply: false,
}))

bot.conversation('complaint', async (c, ctx) => {
  await ctx.reply('📝 Tell us what went wrong with your order:')
  const text = await c.waitText()
  const summary = await ctx.tools.ai.ask(
    `Summarize this customer complaint in 3 lines for the support team: ${text}`,
  )
  await ctx.reply(`✅ We logged your complaint:\n${summary}`)
})
```

`ctx.tools.ai` is an `AIClient`:

| Method | What it does |
|---|---|
| `ask(prompt, opts?)` | One-shot question, **without** chat history. Uses the plugin's `persona`, `model`, `maxTokens`, `effort` and [tools](/guide/ai-tools). Resolves with the text. |
| `replyInChat(chatKey, text, opts?)` | Answers inside a chat's history (reads it and stores the turn), like the autoresponder. Use `chatKeyOf(ctx)` as the key; `opts` takes `{ userId, isGroup }` for [memory](/guide/ai-memory-rag) and `{ ctx, confirm, signal }` for tools. |
| `replyInChatDetailed(chatKey, text, opts?)` | Same, and also returns the citations and facts the turn used. |
| `streamReplyInChat(chatKey, text, opts?)` | Streaming twin of `replyInChat`, to pass to [`ctx.stream()`](/guide/streaming). |
| `runTools(input, opts?)` | Runs the [tool loop](/guide/ai-tools) and returns its full result. |
| `generate({ messages, system?, model?, maxTokens?, effort?, signal? })` | Full control: explicit messages and per-call overrides. Resolves with `{ text, model, stopReason?, usage? }`. |
| `stream(input)` | Like `generate`, as an `AsyncIterable<string>` of text deltas. |
| `memory()`, `memoryFacts()`, `remember()`, `forget()`, `extractMemory()`, `idle()` | The [long-term memory](/guide/ai-memory-rag#reading-and-writing-memory) API. |
| `clearToolHistory(chatKey)` | Forgets the [side-effecting tool runs](/guide/ai-tools#repeated-side-effects) remembered for a chat. |

**Typing (TypeScript).** Importing `@botmesh/ai` augments the core's
`DefaultTools`, so `ctx.tools.ai` (and `bot.injectTools.ai` outside handlers)
is typed as `AIClient` with no casts. The type does not check that the plugin
is installed: without `bot.plug(aiPlugin(...))`, or after unplugging it,
`ctx.tools.ai` is `undefined` at runtime.

## Thinking (Anthropic)

Claude models think before answering. `@botmesh/ai` picks the right request
for the model you configure (`thinking: 'auto'`, the default):

| Model | What is sent |
|---|---|
| Claude Opus / Sonnet 4.6 and later, Haiku 5 and later, Fable, Mythos, unknown ids | `thinking: { type: 'adaptive' }` (+ `effort` when set) |
| Claude Haiku 4.5, Sonnet 4.5, Opus 4.5 and older | no `thinking` (and no `effort`, except on Opus 4.5) |

```ts
aiPlugin({ provider: 'anthropic', model: 'claude-haiku-4-5', thinking: { budgetTokens: 2048 } })
```

- `'adaptive'` always sends adaptive thinking; `'off'` never sends the
  parameter (models that always think, such as Claude Opus 5.5, keep doing so:
  lower `effort` instead).
- `{ budgetTokens }` (a positive integer; anything else throws a `RangeError`
  when the config is built) enables budgeted thinking (`budget_tokens`, raised to
  the minimum of 1024) on the models without adaptive thinking (Haiku 4.5,
  Sonnet 4.5, Opus 4.5 and older). Adaptive models get adaptive thinking
  instead: Opus / Sonnet 4.6 still accept budgets but deprecate them, and Opus
  4.7+, Sonnet 5+, Haiku 5+, Fable and Mythos reject them. When `maxTokens`
  would leave no room for the answer it becomes `budgetTokens + maxTokens`.
- If the API still rejects the request with a 400 that names `thinking` (or
  `effort`), the call is retried once without that parameter and the model is
  remembered, so the next calls skip it. `anthropicModelSupport(model)` exposes
  the rules.

## Tools, memory, RAG and streaming

Each has its own guide; this is what they look like in the plugin config.

**[Tool calling](/guide/ai-tools)**: the model calls your functions (search the
catalog, place an order), with argument validation, timeouts, a human
confirmation for `confirm: true` tools and audit events.

```ts
bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',
  tools: {
    search_product: {
      description: 'Search the catalog by text',
      schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      handler: async ({ q }: { q: string }) => db.products.search(q),
    },
  },
}))
```

**[Memory and RAG](/guide/ai-memory-rag)**: `memory` remembers facts about each
user across conversations (stored in `ctx.user`); `rag` answers from your
documents with numbered citations, through any retriever, such as `createRag()`
from the experimental `@botmesh/rag`.

```ts
import { createRag } from '@botmesh/rag'

bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',
  memory: { autoExtract: true, ttl: '90d' },
  rag: { retriever: createRag({ documents: ['./docs/faq.md'] }), appendSources: true },
}))
```

**[Streaming](/guide/streaming#with-botmesh-ai)**: `stream: true` sends the
autoreply while it is generated: native drafts on Telegram, live edits on
Discord, sentence chunks with "typing…" on WhatsApp. Turns with tools are not
streamed.

## Formatting per channel

Models write Markdown (`**bold**`, `# heading`, `[link](url)`, `- item`), but
most chat apps do not render it. The autoresponder converts each reply (also
when streaming) to the format of the chat, `ctx.textFormat`: the provider's
per-chat `textFormatFor(chatId)` when it serves several channels, else its
`capabilities.textFormat`.

| `textFormat` | Providers | Result |
|---|---|---|
| `'whatsapp'` | `baileys`, `meta`, evolution, wppconnect, gupshup; twilio `whatsapp:` chats; highlevel WhatsApp contacts | `*bold*`, `_italic_`, `~strike~`, `•` bullets, headings in bold, links as `text (url)` |
| `'plain'` | `telegram` (sent without `parse_mode`), messenger, instagram, tiktok; twilio SMS chats; highlevel SMS, Email, FB, IG, Live chat, GMB contacts | markers stripped |
| `'markdown'` | discord | unchanged |
| not declared | other providers (email) | unchanged |

Code spans and fenced blocks are never touched, and neither are `snake_case`
words or `2 * 3`. The stored history keeps the model's original text.
`format: 'whatsapp'` (or any format) forces one; `format: false` sends the text
as is. `formatMarkdown(text, format)` and `formatMarkdownStream(source, format)`
are exported for your own handlers. With `'html'` only `http(s)`, `mailto:` and
`tel:` URLs become `<a href>` links: anything else (a `javascript:` link a
prompt injection could produce) stays as text.

## Voice notes

The autoresponder answers text messages only. With the experimental
[`@botmesh/voice`](/guide/voice) plugin, voice notes are transcribed before
routing (use `autoTranscribe: { asText: true }` so the AI answers them) and
`autoReplyWithVoice` can send the answer back as audio.

## Language of the built-in replies

The texts the plugin writes for you (the error and refusal replies, the tool
confirmation prompt and its Yes/No buttons, the sources line) follow the
chat's language, `ctx.lang`. English and Spanish are built in; English is the
default. A Spanish-only bot sets `lang: 'es'` on the `Bot`:

```ts
import { Bot } from '@botmesh/core'

const bot = new Bot({ provider, lang: 'es' })
```

Override any text with `bot.locale()` under the `ai.` keys (`ai.error`,
`ai.refusal`, `ai.tools.confirm`…, listed in `AI_MESSAGES`), or set
`errorMessage`, `refusalMessage` and `maxStepsMessage` on the plugin. See
[i18n](/guide/i18n).

## `/reset` and `slashCommandsPlugin`

`aiPlugin` registers its own `/reset`: it clears the chat's AI context **and**
cancels the active conversation. Command registration is "last `plug()`
wins", so if you also use `slashCommandsPlugin` (which ships its own `/reset`
to cancel conversations), **install `aiPlugin` after it** so its `/reset`
takes precedence:

```ts
bot.plug(slashCommandsPlugin, { greeting: '🤖 Hi!' })
bot.plug(aiPlugin({ apiKey: process.env.ANTHROPIC_API_KEY })) // its /reset wins
```

## Cost and latency

Every autoreply turn is one paid model call (more with tools). To keep the
bill and the wait down:

- **Answer the obvious without AI.** Commands, `bot.when()` triggers and flows
  run before the autoresponder; FAQs, menus and greetings handled there never
  reach the model.
- **Pick the model per job.** A small model is usually enough for support chat;
  give the background memory extraction a cheaper one
  (`memory: { autoExtract: { model: '...' } }`).
- **Cap the output.** `maxTokens` limits each answer (it includes the thinking
  tokens of reasoning models); on Anthropic, `effort: 'low'` thinks less.
- **Send less history.** Each turn resends the chat window: lower
  `context.maxMessages` for short exchanges. With RAG, fewer and smaller
  passages (`topK`, `chunkSize`) mean a shorter prompt.
- **Bound the tool loop.** Each step is one model call: keep `maxSteps` low
  and give tools precise descriptions so the model calls the right one first.
- **Stay quiet in groups.** `groupMode: 'mentions'` on the `Bot` makes the bot
  answer group messages only when mentioned.
- **Feel faster.** `stream: true` shows the answer as it is written;
  `humanizeTyping` (on by default) shows "typing…" meanwhile.
- **Protect your quota.** [Rate limiting](/guide/rate-limiting) caps how many
  messages a chat can push through, and `timeoutMs` bounds each call.
- **Measure.** With [tracing](/guide/tracing#ai-spans), every model call is a
  span with its model and token usage.

## Errors and troubleshooting

`aiPlugin` **never crashes the process** over a misconfigured provider (SDK not
installed, unknown provider, missing API key): `install` is synchronous and
resolves the provider lazily. At startup a warmup logs the problem as an error,
and each message then gets the `errorMessage` reply instead of an answer.

A configuration that can never work fails fast instead: `aiPlugin()` throws a
`RangeError` / `TypeError` naming the option for a timeout that is not a finite
number of ms (a `NaN` from `Number(process.env.X)` would fire after 1 ms), a
`maxTokens` that is not a positive integer, a negative or `NaN`
`context.maxMessages`, invalid `memory` limits, an unparsable
`toolConfirm.timeout` or a tool without `handler`.

`bot.stop()` aborts every model call still in flight: the autoreply turns,
background memory extraction and the calls your own handlers make through
`ctx.tools.ai`, which reject with an `AbortError`. A slow provider never keeps
the process alive. A call that exceeds `timeoutMs` rejects with
`AITimeoutError`.

| What you see | Why | Fix |
|---|---|---|
| Error log `ai provider failed to resolve`: `This AI provider needs the package "openai", which is not installed` | The provider's SDK is missing | Run the `pnpm add` command in the message |
| Warning at install: `ai provider "openai" has no default model` | `openai` or `ollama` without `model` | Set `model` |
| Every message gets "⚠️ I can't answer right now, please try again later." | The provider call failed (bad key, quota, network, timeout) | Look for `ai autoreply failed` in the log: it carries the provider's error |
| `Ollama answered HTTP 404` | The model is not pulled | `ollama pull <model>` |
| `fetch failed` / `ECONNREFUSED` with Ollama | No Ollama server at `baseUrl` | Start it (`ollama serve`) or fix `baseUrl` |
| Warning `ai autoreply: the model returned an empty answer` or `ai tool call cut off by the output token limit` | The answer ran out of `maxTokens` (often spent thinking) | Raise `maxTokens` or lower `effort` |
| The bot ignores images, audio or stickers | The autoresponder answers text only | Handle them with `bot.when(IMAGE, ...)`, or transcribe voice with [`@botmesh/voice`](/guide/voice) |
| The bot does not answer a message | Another handler, command or conversation consumed it, or `groupMode` filtered a group message | Expected: the autoresponder is the last catch-all |
| `/reset` cancels the flow but the AI keeps its history | `slashCommandsPlugin` was plugged after `aiPlugin` | Plug `aiPlugin` last |

## Full `aiPlugin(config)` reference

| Field | Type | Default | Description |
|---|---|---|---|
| `provider` | `'anthropic' \| 'openai' \| 'ollama' \| 'gemini' \| 'deepseek' \| 'qwen' \| 'glm' \| 'kimi' \| 'groq' \| 'openrouter' \| 'mistral' \| 'grok' \| 'together'` | `'anthropic'` | Provider to resolve. |
| `model` | `string` | per provider | Model to use (required for `openai` and `ollama`). |
| `apiKey` | `string` | env var | API key. If omitted, each provider reads its conventional env var. |
| `baseUrl` | `string` | per provider | Endpoint override (SDK `baseURL` for anthropic/openai/presets, `httpOptions.baseUrl` for gemini, the Ollama host). |
| `instance` | `AIProvider` | — | A ready-built provider (`MockAIProvider` in tests, a `GeminiProvider` for Vertex AI, your own): skips `provider`/`apiKey`/`model` resolution and the SDK load. |
| `persona` | `string` | — | System prompt. |
| `maxTokens` | `number` | `4096` (anthropic), `1024` (openai, presets, gemini), none (ollama) | Output token limit; on reasoning models it includes the thinking tokens. Ollama gets it as `options.num_predict`, only when set. |
| `effort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | — | Reasoning effort (Anthropic only; not sent to models that reject it, such as Claude Haiku 4.5 / Sonnet 4.5). |
| `thinking` | `'auto' \| 'adaptive' \| 'off' \| { budgetTokens }` | `'auto'` | Anthropic extended thinking, see [Thinking](#thinking-anthropic). |
| `timeoutMs` | `number` | `60000` | Timeout of each model call. Without streaming, a total deadline: the request is aborted and rejects with `AITimeoutError`, so a hung provider can't block the chat's queue. With streaming, an idle timeout that restarts on every chunk, so a long answer is never cut. `0` disables it (not recommended). |
| `maxTokensField` | `'max_tokens' \| 'max_completion_tokens'` | by `baseUrl` | OpenAI-compatible providers: the field of the output-token cap (see [OpenAI](#openai)). |
| `context.maxMessages` | `number` | `20` | History window kept per chat (it always starts with a user turn; empty answers are not stored). |
| `autoReply` | `boolean` | `true` | Registers the catch-all autoresponder. |
| `resetCommand` | `boolean` | `true` | Registers `/reset`. |
| `errorMessage` | `string` | `ai.error`: `'⚠️ I can't answer right now, please try again later.'` | Reply when the provider fails or the model answers nothing. |
| `refusalMessage` | `string` | `ai.refusal`: `'I can't help with that.'` | Reply when the provider refuses (`stopReason === 'refusal'`: Anthropic refusal, OpenAI `refusal`, Gemini safety block). |
| `humanizeTyping` | `boolean` | `true` | Shows "typing…" (`ctx.typing()`) while the answer is generated; the reply then skips the `BotConfig.typing` pacer, so the indicator shows once. |
| `tools` | `Record<string, AITool>` | — | Functions the model may call (see [AI tool calling](/guide/ai-tools)). |
| `maxSteps` | `number` | `5` | Max model calls per turn in the tool loop. |
| `toolTimeoutMs` | `number` | `15000` | Default per-tool timeout (`0` disables it). |
| `maxStepsMessage` | `string` | `ai.tools.maxSteps`: `"I couldn't complete the request. Please try again with more detail."` | Reply when the tool loop hits `maxSteps`. |
| `toolConfirm` | `{ yes?, no?, timeout?, buttons?, answeredNotice?, expiredNotice?, systemNote? }` | `{ timeout: '2m', buttons: true }` | Confirmation dialog of `confirm: true` tools (see [Human confirmation](/guide/ai-tools#human-confirmation)). |
| `onToolEvent` | `(event: AIToolEvent) => void` | — | Audit hook for every tool loop event (also emitted as `bot.on('ai.tool')`). |
| `format` | `'auto' \| 'whatsapp' \| 'markdown' \| 'html' \| 'plain' \| false` | `'auto'` | Converts the model's Markdown to the channel's format (see [Formatting per channel](#formatting-per-channel)). |
| `memory` | `boolean \| AIMemoryConfig` | — | Long-term per-user memory (see [AI memory & RAG](/guide/ai-memory-rag)). |
| `rag` | `AIRetriever \| AIRagConfig` | — | Answers grounded in your documents (see [AI memory & RAG](/guide/ai-memory-rag#rag)). |
| `stream` | `boolean \| AIStreamConfig` | off | Streams the autoreply with `ctx.stream()` (see [Streaming](/guide/streaming#with-botmesh-ai)). |

The default texts are the English ones; a chat in Spanish gets the Spanish
built-ins (see [Language of the built-in replies](#language-of-the-built-in-replies)).

## Testing

`MockAIProvider` (from `@botmesh/ai/testing`) implements `AIProvider` with
fixed or scripted replies and no network calls. Plug it into the real plugin
with `instance`:

```ts
import { aiPlugin } from '@botmesh/ai'
import { MockAIProvider } from '@botmesh/ai/testing'
import { createTestBot } from '@botmesh/core/testing'

const { bot, chat } = await createTestBot()
bot.plug(aiPlugin({ instance: new MockAIProvider({ reply: 'We open at 7.' }) }))

await chat.send('when do you open?')
await chat.expectReply('We open at 7.')
```

Without a bot, `AIClient` takes the provider and a `ContextManager` over any
`ConvStore` (the bot's store is one):

```ts
import { AIClient, ContextManager, type ConvStore, type AIMessage } from '@botmesh/ai'
import { MockAIProvider } from '@botmesh/ai/testing'

const memory = new Map<string, AIMessage[]>()
const store: ConvStore = {
  async getConversation(k) { return memory.get(k) },
  async setConversation(k, m) { memory.set(k, m) },
  async clearConversation(k) { memory.delete(k) },
}

const client = new AIClient(new MockAIProvider({ reply: 'mock reply' }), new ContextManager(store))

const answer = await client.ask('what time is it?')
// answer === 'mock reply'
```

`reply` can also be a function of the request that returns `{ toolCalls }` to
script tool calls (see [Testing in the tool calling guide](/guide/ai-tools#testing)),
and `mock.calls` records every request the client sent.

The package has three entries:

| Entry | Contents | Semver |
|---|---|---|
| `@botmesh/ai` | `aiPlugin`, `AIClient`, the providers, tools, memory and RAG types, `formatMarkdown` | yes |
| `@botmesh/ai/testing` | `MockAIProvider` and `validateArgs` (checks a tool's arguments against its schema, as the tool loop does) | yes |
| `@botmesh/ai/internal` | The plugin's helpers and the SDK wire type names | no |

A custom `AIProvider` that streams should honour `GenerateInput.onStreamEnd`:
call it once, after the last chunk, only when the stream ends normally (not on
an error, an abort or an early `break`), with an `AIStreamEndInfo`
(`stopReason`, `usage` when known). Check `signal.aborted` before calling it: a
client that ignores the signal would otherwise end "normally" after an abort.

## Limitations

- The history is a fixed window of messages (`context.maxMessages`); older
  turns are dropped, not summarized.
- One persona per plugin: a bot that needs several picks them in its own
  handlers with `ctx.tools.ai.generate({ system, messages })`.
- The autoresponder answers text only (see [Voice notes](#voice-notes)).

## Next steps

- [AI tool calling](/guide/ai-tools) — let the model call your bot's functions
- [AI memory & RAG](/guide/ai-memory-rag) — per-user facts and answers from your documents
- [Streaming replies](/guide/streaming) — `ctx.stream()` per channel
- [Voice](/guide/voice) — transcribe voice notes and answer with audio
- [Handoff](/guide/handoff) — hand the chat to a human
- [Plugins](/guide/plugins) — how `bot.plug()` works in general
