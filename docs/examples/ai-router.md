# AI router: intents to flows, chit-chat to the AI

A phone-company bot where the model only classifies free text: payments and order tracking run as deterministic flows, and the rest is answered by the AI.

**Level:** Advanced · **Tags:** AI, Flows, Intent routing, WhatsApp, Telegram

**Features shown:** [`ctx.tools.ai.generate()`](/guide/ai#use-the-ai-from-your-code-ctx-tools-ai) ·
[`replyInChat()` with chat history](/guide/ai#use-the-ai-from-your-code-ctx-tools-ai) ·
[flows with validation and menus](/guide/flows) ·
[starting a flow from code (`bot.trigger`)](/guide/messages#starting-a-flow-programmatically) ·
[catch-all handler](/guide/first-bot#_6-catch-all) ·
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

## The bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin, chatKeyOf } from '@botmesh/ai'

const INTENTS = ['payment', 'order', 'chat']
const CLASSIFIER = [
  'Classify the message a customer sent to Nimbus Mobile, a phone company, with one label:',
  'payment (wants to pay a bill or asks how to pay),',
  'order (asks where an order, a phone or a SIM card delivery is),',
  'chat (anything else). Reply with the label only.',
].join(' ')

// One small, bounded model call. The label is checked in code: the model only picks.
async function classify(ctx) {
  const { text } = await ctx.tools.ai.generate({
    system: CLASSIFIER,
    messages: [{ role: 'user', content: ctx.body }],
    maxTokens: 100,
    effort: 'low',
  })
  const label = text.trim().toLowerCase().replace(/[^a-z]/g, '')
  return INTENTS.includes(label) ? label : 'chat'
}

// Stand-in for your order system.
const trackOrder = (id) => `📦 Order ${id.toUpperCase()} left our warehouse and arrives tomorrow.`

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  bot.plug(slashCommandsPlugin, {
    greeting: '📱 Hi! I am the Nimbus Mobile assistant. I can take a payment, track an order or answer questions.',
  })

  // Deterministic flows. Typing their name ("payment", "order") starts them without any AI call.
  bot.use(
    flow('payment')
      .say('💳 *Pay your bill*')
      .ask('What is your account number? (6 digits)', 'account', {
        validate: (body) => (/^\d{6}$/.test(body.trim()) ? true : '❌ The account number has 6 digits, try again'),
      })
      .choose('How do you want to pay?', { card: 'Card', transfer: 'Bank transfer' }, 'method')
      .say((_ctx, c) => `✅ We sent a ${c.state.method === 'card' ? 'card payment' : 'bank transfer'} link for account ${c.state.account}.`),
  )
  bot.use(
    flow('order')
      .ask('What is your order number? (like N-1234)', 'id', {
        validate: (body) => (/^n-\d{4}$/i.test(body.trim()) ? true : '❌ That does not look like N-1234, try again'),
      })
      .say((_ctx, c) => trackOrder(c.state.id.trim())),
  )

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',
    persona: 'You are the assistant of Nimbus Mobile, a phone company. Answer briefly and only about Nimbus Mobile.',
    autoReply: false, // the router below decides who answers
  }))

  // Free text: classify, then hand off to a flow or let the AI answer.
  bot.onMessage(async (ctx) => {
    const intent = await classify(ctx)
    if (intent === 'chat') {
      await ctx.reply(await ctx.tools.ai.replyInChat(chatKeyOf(ctx), ctx.body))
      return
    }
    await bot.trigger(intent, { chatId: ctx.from, userId: ctx.sender, isGroup: ctx.isGroup })
  })

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'router-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

- **The model classifies, your code decides.** `classify()` asks for one
  label with `ctx.tools.ai.generate()`, a call without chat history or persona.
  The answer is cleaned and checked against `INTENTS`; anything unexpected
  falls back to `chat`, so a confused model can never start a flow you did not
  list.
- **Money stays deterministic.** The payment flow validates the account
  number, offers a fixed menu and builds the confirmation in code. The model
  never sees the account number or decides the amount.
- **`bot.trigger()` starts the flow.** It is safe to `await` from a handler of
  the same chat: it runs in that message's turn. The flow then owns the next
  messages, exactly as if the user had typed its name.
- **Chit-chat keeps a history.** `replyInChat(chatKeyOf(ctx), text)` reads and
  stores the chat's AI history and uses the plugin's persona. With
  `autoReply: false` the plugin does not add its own catch-all.
- **Cost.** Keywords ("payment", "order") and slash commands skip the
  classifier. The classifier call is short (`maxTokens: 100`,
  `effort: 'low'`); `maxTokens` includes the thinking tokens of reasoning
  models, so do not set it too low.

## Try it

```bash
npx botmesh dev bot.js --env-file .env   # .env has the line ANTHROPIC_API_KEY=sk-ant-...
```

A run of the code above in the terminal simulator. The model (the classifier
labels and the chit-chat answer) is scripted by the test that runs this page
(`packages/ai/tests/docs-examples-ai.test.ts`); the flows are the real ones.

```text
user › hi, I'd like to pay my bill please
bot › 💳 *Pay your bill*
bot › What is your account number? (6 digits)
user › 12345
bot › ❌ The account number has 6 digits, try again
user › 123456
bot › How do you want to pay?

      1) Card
      2) Bank transfer
user › 1
bot › ✅ We sent a card payment link for account 123456.
user › where is my new SIM card?
bot › What is your order number? (like N-1234)
user › N-2041
bot › 📦 Order N-2041 left our warehouse and arrives tomorrow.
user › thanks, you are great!
bot › Happy to help! 😊 Anything else about your Nimbus plan?
```

## Other model providers

::: details Switch to OpenAI, Gemini or a local Ollama model
Change the `aiPlugin` options; `effort` is ignored by providers other than
Anthropic.

OpenAI (`npm install openai`, key in `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', autoReply: false })
```

Gemini (`npm install @google/genai`, key in `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', autoReply: false })
```

Ollama on your machine (no package, no key; run `ollama pull llama3.1` first):

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', autoReply: false })
```
:::

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR code: scan it with WhatsApp (**Linked devices**).
For Telegram, install `@botmesh/telegram` and start the factory with
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`.

## Next steps

- [Conversation flows](/guide/flows): every step of the flow DSL
- [AI with human escalation](./ai-handoff): let the model pass the chat to a person
- [Examples overview](./index)
