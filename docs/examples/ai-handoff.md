# AI support with human escalation

An internet-provider assistant that solves what it can and, when it should not go on, hands the chat to a person with a summary written for the agent.

**Level:** Advanced · **Tags:** AI, Tools, Handoff, WhatsApp, Telegram

**Features shown:** [AI tool calling](/guide/ai-tools) ·
[human handoff (`ctx.handoff`, `bot.resume`)](/guide/handoff#human-handoff) ·
[escape commands while handed off](/guide/handoff#what-happens-while-a-chat-is-handed-off) ·
[`'message'` and `'handoff'` events](/guide/handoff#human-handoff) ·
[sending to another chat (`bot.send`)](/guide/handoff#human-handoff) ·
[`enum` validation of arguments](/guide/ai-tools#schemas)

## Prerequisites

- Node.js 22.12 or newer.
- An Anthropic API key in the `ANTHROPIC_API_KEY` environment variable (or
  another model with tool calling, see [below](#other-model-providers)).
- Optional: `AGENTS_CHAT_ID`, the chat where your agents get the summaries
  (for example a WhatsApp group id).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

While the packages are in prerelease, add the dist-tag shown in
[Getting started](/guide/getting-started#requirements).

## The bot

```js
// bot.js
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

// Where agents receive the summaries: a group or an agent's chat id.
const AGENTS_CHAT = process.env.AGENTS_CHAT_ID ?? 'agents'

const PERSONA = [
  'You are the support assistant of Skyline Internet, a home internet provider.',
  'Help with connection problems, plans and bills, in short messages.',
  'Call escalate_to_human when the customer asks for a person, is upset, or needs something you cannot do:',
  'refunds, contract changes or technician visits. Never promise refunds or visits yourself.',
].join(' ')

const createBot = defineBot((provider) => {
  // While a chat is handed off, only the /bot command still reaches the bot.
  const bot = new Bot({ provider, handoff: { allowCommands: ['bot'] } })

  const tools = {
    escalate_to_human: {
      description: 'Hand the chat to a human agent, with a summary the agent can act on without reading the chat.',
      schema: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['customer_request', 'refund', 'technician', 'upset_customer', 'other'] },
          summary: { type: 'string', description: 'Two or three lines: the problem, what was tried, what the customer wants.' },
        },
        required: ['reason', 'summary'],
        additionalProperties: false,
      },
      handler: async ({ reason, summary }, { ctx }) => {
        await bot.send(AGENTS_CHAT, `🆘 New case from ${ctx.from} (${reason})\n${summary}`)
        await ctx.handoff({ reason, meta: { summary } }) // the bot stops answering this chat
        return { handedOff: true }
      },
    },
  }

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-5-5',
    persona: PERSONA,
    tools,
  }))

  // A handed-off chat still emits 'message': relay it to the agents.
  bot.on('message', (ctx) => {
    if (bot.isHandedOff(ctx.from)) void bot.send(AGENTS_CHAT, `💬 ${ctx.from}: ${ctx.body}`)
  })

  // Return the chat to the bot. Your inbox can call bot.resume(chatId) when the agent closes the case.
  bot.command('bot', async (ctx) => {
    await bot.resume(ctx.from, { reason: 'back to the bot' })
    await ctx.reply('🤖 The assistant is back. How can I help?')
  })

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'support-bot' }))
  bot.on('handoff', ({ chatId, reason }) => console.log(`👤 ${chatId} handed to a human (${reason})`))
  await bot.start()
}
```

## How it works

- **The model decides when to escalate.** `escalate_to_human` is an ordinary
  tool: the persona says when to call it, and the `enum` keeps `reason` to a
  closed set you can route on (queues, priorities).
- **The summary is a tool argument.** The model writes it while deciding to
  escalate, so the agent gets "problem, what was tried, what the customer
  wants" without an extra model call.
- **`ctx.handoff()` pauses the bot in that chat.** Messages are still stored,
  hooks run and the `'message'` event fires (the example relays them to the
  agents, starting with the message that triggered the escalation), but no
  handler, flow or AI answers. The state survives restarts
  with a persistent store.
- **Getting the bot back.** `handoff.allowCommands: ['bot']` lets `/bot`
  through while handed off; in production your inbox calls
  `bot.resume(chatId)` when the agent closes the case. Agents answer the
  customer with `bot.send(chatId, text)`.
- **No confirmation here.** Escalating has no side effect for the customer,
  so the tool has no `confirm: true`; keep it for refunds or bookings.

## Try it

```bash
npx botmesh dev bot.js --env-file .env   # .env has the line ANTHROPIC_API_KEY=sk-ant-...
```

A run of the code above in the terminal simulator, where the customer's chat
is `user`. The model is scripted by the test that runs this page
(`packages/ai/tests/docs-examples-ai.test.ts`); the handoff, the relay to
`agents` and `/bot` are real. Lines marked `bot → agents` are what the agents'
chat receives.

```text
user › my internet has been down since yesterday
bot › Sorry about that! Please unplug your router for 30 seconds and plug it back in. Did that help?
user › I already did that twice. I want a technician and a refund
bot → agents › 🆘 New case from user (technician)
               Internet down since yesterday; router restarted twice with no change. Wants a technician visit and a refund for the days without service.
bot › I have passed your case to our team: a person will write to you here shortly.
bot → agents › 💬 user: I already did that twice. I want a technician and a refund
user › hello?
bot → agents › 💬 user: hello?
user › /bot
bot › 🤖 The assistant is back. How can I help?
```

## Other model providers

::: details Switch to OpenAI, Gemini or a local Ollama model
Tool calling works on every provider; on Ollama pick a model tagged *tools*.

OpenAI (`npm install openai`, key in `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA, tools })
```

Gemini (`npm install @google/genai`, key in `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA, tools })
```

Ollama on your machine (no package, no key; run `ollama pull qwen3` first):

```js
aiPlugin({ provider: 'ollama', model: 'qwen3', persona: PERSONA, tools })
```
:::

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR code: scan it with WhatsApp (**Linked devices**) and
set `AGENTS_CHAT_ID` to the group where your agents are. For Telegram, install
`@botmesh/telegram`, start the factory with
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })` and use the
numeric id of the agents' group.

## Next steps

- [Human handoff & access lists](/guide/handoff): everything the handoff gate does
- [AI booking assistant](./ai-tools-booking): tools with confirmation and `dedupe`
- [Examples overview](./index)
