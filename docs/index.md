---
layout: home

hero:
  name: botmesh
  text: One bot, every chat channel
  tagline: A TypeScript framework for messaging bots. Write handlers and conversation flows once, run them on WhatsApp (Baileys or the official Cloud API) and Telegram, and try them in your terminal without a phone.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Your first bot
      link: /guide/first-bot
    - theme: alt
      text: API reference
      link: /api/

features:
  - title: Transport-agnostic
    details: |
      One engine, many providers: @botmesh/baileys (WhatsApp Web),
      @botmesh/meta (official WhatsApp Cloud API), @botmesh/telegram,
      @botmesh/messenger, @botmesh/instagram, Discord, Twilio, email and more.
      Switching channels changes one line.
    icon: 🔌
    link: /guide/channels
    linkText: Channels
  - title: Conversation flows
    details: |
      flow('signup').ask().choose().say() compiles to a real async
      conversation with validation, retries, branching and timeouts.
      Persistent flows survive a restart.
    icon: 🔀
    link: /guide/flows
    linkText: Flows
  - title: Try it without a phone
    details: |
      npx botmesh dev bot.js chats with your bot in the terminal, with hot
      reload and no account, number or ban risk.
    icon: 💻
    link: /guide/dev-simulator
    linkText: Terminal simulator
  - title: Testable
    details: |
      createTestBot and MockProvider run your flows in unit tests with no
      network. Golden transcripts catch regressions in whole conversations.
    icon: ✅
    link: /guide/testing
    linkText: Testing
  - title: AI when you need it
    details: |
      @botmesh/ai answers with Anthropic, OpenAI, Gemini, Ollama or
      OpenAI-compatible models, calls your tools with confirmation and
      remembers each user.
    icon: 🤖
    link: /guide/ai
    linkText: AI plugin
  - title: Hooks and plugins
    details: |
      before / after / onError middleware on every message and send, and
      reusable plugins such as the built-in slash commands.
    icon: 🧩
    link: /guide/plugins
    linkText: Plugins
  - title: Pluggable stores
    details: |
      MemoryStore by default; @botmesh/sqlite-store and @botmesh/redis-store
      for persistence, or your own IStore.
    icon: 📦
    link: /guide/store
    linkText: Stores
  - title: Ready for production
    details: |
      Inbound dedupe on by default and an anti-ban rate limiter on Baileys;
      opt-in durable processing, multiple replicas, a durable scheduler and
      OpenTelemetry traces.
    icon: 🚀
    link: /guide/deploy
    linkText: Deployment
  - title: Typed throughout
    details: |
      ESM packages written in TypeScript: autocomplete and type checking on
      every handler, flow state and plugin. Plain JavaScript works too.
    icon: 🔷
---

## A bot in a few lines

```js
import { Bot, flow } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }) })

bot.when('hi', (ctx) => ctx.reply('👋 Hello!'))

bot.use(
  flow('signup')
    .ask('What is your name?', 'name')
    .say((_ctx, c) => `Nice to meet you, ${c.state.name}!`),
)

await bot.start() // scan the QR with WhatsApp → Linked devices
```

Swap `BaileysProvider` for `TelegramProvider` or `CloudAPIProvider` and the
rest of the code stays the same.

## Start in five minutes

```bash
npm create botmesh my-bot
cd my-bot && npm install
npm run dev        # chat with it in the terminal
npm start          # connect WhatsApp or Telegram
```

botmesh is in prerelease and these docs describe the upcoming release: during
the beta, add the tag (`npm create botmesh@beta my-bot`). The older alphas on
npm today differ in places. [Getting started](/guide/getting-started) explains
which version to install and walks through every step, including setting up a
project by hand.
