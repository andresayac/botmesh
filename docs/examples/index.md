# Examples

Complete bots you can copy, run and adapt. Each example is one `bot.js`
file that shows a set of botmesh features, with a transcript captured from a
real run and links to the guide of every feature it uses. A test runs every
example's code and checks its transcript, so what you read is what you get.

## Run any example

1. Set up a project once, as in
   [Getting started](/guide/getting-started#requirements) (Node.js 22.12+,
   `"type": "module"`, `npm install @botmesh/core @botmesh/baileys`).
2. Save the example's code as `bot.js`.
3. Chat with it in the terminal, no phone needed:

   ```bash
   npx botmesh dev bot.js
   ```

4. Connect it for real with `node bot.js` (a QR code for WhatsApp), or swap
   the provider for [Telegram](/guide/getting-started#or-connect-telegram).
   The bot code does not change between channels.

## Beginner

| Example | Level | Tags | Features | What you'll build |
| --- | --- | --- | --- | --- |
| [Greeting bot](./greeting-bot) | Beginner | Commands | `WELCOME`, text and regex triggers, `ctx.pass()`, slash commands, catch-all | A bot that welcomes each user once, says hello, echoes and lists its commands |
| [FAQ bot](./faq-bot) | Beginner | Triggers | Normalized matching, keyword lists, `contains`, regex, precedence | Keyword answers to frequent questions, with a fallback |
| [Send messages](./messages) | Beginner | Triggers | Trigger forms, `ctx.quote()`, `ctx.react()`, sender info | Every way to answer a text message |
| [Menu bot](./menu-bot) | Beginner | Flows, Buttons | `flow().choose()`, `then` sub-flows, `bot.conversation()`, buttons per channel | A pizza-place menu that works on every channel |
| [Poll bot](./poll-bot) | Beginner | Polls, Reactions | `ctx.poll()`, `bot.on('poll')`, `bot.send()`, `ctx.react()` | Native polls answered with the live tally |
| [Media replies](./media) | Beginner | Media | Photo, file, video, voice, sticker, location, contact; `bot.onType()`, `loadMediaOf()` | A bot that sends every media kind and reacts to images |
| [Reminder bot](./reminders) | Beginner | Scheduler | `bot.delay()`, `bot.schedule()` with time zone, `task.cancel()`, `bot.send()` | One-off reminders and a daily tip at 9:00 |
| [Registration flow](./registration-flow) | Beginner | Flows, Forms | `.ask()` with `validate`, `.do()`, `c.state`, `.timeout()`, `/cancel` | A validated sign-up that saves the user |

## Intermediate

| Example | Level | Tags | Features | What you'll build |
| --- | --- | --- | --- | --- |
| [Shopping flow](./shopping-flow) | Intermediate | Flows | `.choose()`, `then` sub-flows, `goto`, computed state, timeouts | A small shop with quantity, confirmation and address |
| [Support with timeout](./support-flow) | Intermediate | Conversations | `bot.conversation()`, `c.waitText()`, `c.choose()`, `ConversationTimeout`, `ConversationCancelled` | A support desk that opens tickets and handles abandoned sessions |
| [Plugin: rate limiter](./rate-limiter) | Intermediate | Plugins, Hooks | `definePlugin()`, `before('message')`, `abort()`, `onDispose()` | A reusable plugin that limits messages per user |
| [Appointment booking](./appointment-booking) | Intermediate | WhatsApp, Forms, SQLite | `.persistent()`, `.form()`, `validate` + `maxAttempts`, `SQLiteStore`, `ctx.user` | A booking flow that validates, confirms and resumes after a restart |
| [Order tracking](./order-tracking) | Intermediate | WhatsApp, User data | `ctx.user` namespaces, `bot.conversation()`, `MemoryStore` file | Order lookups that remember what each user follows |
| [Human handoff](./human-handoff) | Intermediate | WhatsApp, Support | `ctx.handoff()`, `bot.resume()`, handoff events, agent commands, `bot.delay()` | A support bot that passes chats to agents and takes them back |
| [Multi-language bot](./multi-language) | Intermediate | WhatsApp, Telegram, i18n | `bot.locale()`, `ctx.t()`, `detect`, `ctx.setLang()`, plurals | A bot that answers each user in English or Spanish |
| [Group bot](./group-bot) | Intermediate | WhatsApp, Telegram, Groups | per-participant conversations, `scope`, mentions, `groupMode`, admin-only commands | A group quiz with a scoreboard and admin commands |
| [WhatsApp and Telegram at once](./whatsapp-and-telegram) | Intermediate | WhatsApp, Telegram, SQLite | `defineBot`, two providers, store namespaces, stable ids | One bot file serving two channels from one process |

## AI

They use [`@botmesh/ai`](/guide/ai) with Anthropic by default; every page shows how to switch to OpenAI, Gemini or a local Ollama model. The API key always comes from an environment variable.

| Example | Level | Tags | Features | What it does |
| --- | --- | --- | --- | --- |
| [AI FAQ assistant](./ai-faq) | Beginner | AI, Guardrails | autoresponder, persona, function triggers, `/reset` | Answers shop questions with an LLM, declines anything off-topic and keeps fixed answers out of the model. |
| [AI booking assistant](./ai-tools-booking) | Intermediate | AI, Tools | tool calling, `confirm: true`, `confirmLines`, `dedupe`, `enum` | Books, lists and cancels appointments through your functions, with a confirmation before each change. |
| [AI answers from your FAQ](./ai-rag) | Intermediate | AI, RAG | `rag` retriever, `appendSources`, `warmup()` | Answers from a Markdown FAQ, cites the section it used and admits what it does not know. |
| [Streaming AI replies](./ai-streaming) | Intermediate | AI, Streaming, Telegram | `stream`, drafts / edits / chunks, cost and latency settings | Shows the answer while the model writes it, tuned for cost and latency. |
| [AI router](./ai-router) | Advanced | AI, Flows | `generate()`, `replyInChat()`, flows, `bot.trigger()` | Classifies free text with the model, runs payments as deterministic flows and leaves chit-chat to the AI. |
| [AI with human escalation](./ai-handoff) | Advanced | AI, Tools, Handoff | tool calling, `ctx.handoff()`, `bot.resume()`, escape commands | Hands the chat to a person with a summary for the agent, then gets it back with `/bot`. |

The bot code of every example is the same on WhatsApp (Baileys) and
Telegram: only the provider changes. Where a channel renders something
differently (buttons, stickers), the example page says so, and the
[capability matrix](/guide/channels#capability-matrix) lists the details.
