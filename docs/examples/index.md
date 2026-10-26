# Examples

Complete bots that show what botmesh can do. Each one is a single file you can copy, run in the terminal with `npx botmesh dev bot.js` and then connect to WhatsApp or Telegram, and each one is run by a test, so the code and the transcript on the page are what you get.

## AI examples

They use [`@botmesh/ai`](/guide/ai) with Anthropic by default; every page shows how to switch to OpenAI, Gemini or a local Ollama model. The API key always comes from an environment variable.

| Example | Level | Tags | Features | What it does |
| --- | --- | --- | --- | --- |
| [AI FAQ assistant](./ai-faq) | Beginner | AI, Guardrails | autoresponder, persona, function triggers, `/reset` | Answers shop questions with an LLM, declines anything off-topic and keeps fixed answers out of the model. |
| [AI booking assistant](./ai-tools-booking) | Intermediate | AI, Tools | tool calling, `confirm: true`, `confirmLines`, `dedupe`, `enum` | Books, lists and cancels appointments through your functions, with a confirmation before each change. |
| [AI answers from your FAQ](./ai-rag) | Intermediate | AI, RAG | `rag` retriever, `appendSources`, `warmup()` | Answers from a Markdown FAQ, cites the section it used and admits what it does not know. |
| [Streaming AI replies](./ai-streaming) | Intermediate | AI, Streaming, Telegram | `stream`, drafts / edits / chunks, cost and latency settings | Shows the answer while the model writes it, tuned for cost and latency. |
| [AI router](./ai-router) | Advanced | AI, Flows | `generate()`, `replyInChat()`, flows, `bot.trigger()` | Classifies free text with the model, runs payments as deterministic flows and leaves chit-chat to the AI. |
| [AI with human escalation](./ai-handoff) | Advanced | AI, Tools, Handoff | tool calling, `ctx.handoff()`, `bot.resume()`, escape commands | Hands the chat to a person with a summary for the agent, then gets it back with `/bot`. |
