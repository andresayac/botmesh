# Support with Timeout

Build a support desk that collects an issue and its urgency, opens a
ticket, and handles abandoned or cancelled sessions with its own messages.

**Level:** Intermediate · **Tags:** WhatsApp, Telegram, Conversations

**Features shown:** [`bot.conversation()`](/guide/flows#beyond-the-dsl) ·
[`c.waitText()` with `timeout` and `validate`](/guide/flows#beyond-the-dsl) ·
[`c.choose()`](/guide/flows#beyond-the-dsl) ·
[`ConversationTimeout` / `ConversationCancelled`](/guide/flows#beyond-the-dsl) ·
[`/cancel` escapes a conversation](/guide/plugins#built-in-slashcommands)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements), which also explains
the prerelease tags). Then install:

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import {
  Bot, ConversationCancelled, ConversationTimeout, defineBot, isMainModule, slashCommandsPlugin,
} from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })
  bot.plug(slashCommandsPlugin)
  let nextTicket = 1001

  // Starts when the user sends "support"
  bot.conversation('support', async (c, ctx) => {
    try {
      await ctx.reply('🛠️ *Technical support*\nDescribe your issue in one sentence (you have 2 minutes):')
      const issue = await c.waitText({
        timeout: '2m',
        validate: (text) => (text.length >= 10 ? true : '✏️ Please give a bit more detail.'),
      })
      const priority = await c.choose('How urgent is it?', {
        high: 'Urgent 🔴',
        medium: 'Today 🟡',
        low: 'No rush 🟢',
      }, { timeout: '2m' })
      await ctx.reply(`🎫 Ticket #${nextTicket++} opened ("${issue}", priority: ${priority}). We will contact you soon.`)
    } catch (err) {
      if (err instanceof ConversationTimeout) await ctx.reply('⏰ Support session expired. Send "support" to start again.')
      else if (err instanceof ConversationCancelled) await ctx.reply('🗑️ Draft ticket discarded.')
      else throw err
    }
  })

  bot.onMessage((ctx) => ctx.reply('Send "support" to open a ticket.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'support-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "support" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`:

```text
user › support
bot › 🛠️ *Technical support*
      Describe your issue in one sentence (you have 2 minutes):
user › broken
bot › ✏️ Please give a bit more detail.
user › My router reboots every hour
bot › How urgent is it?

      1) Urgent 🔴
      2) Today 🟡
      3) No rush 🟢
user › 1
bot › 🎫 Ticket #1001 opened ("My router reboots every hour", priority: high). We will contact you soon.
user › support
bot › 🛠️ *Technical support*
      Describe your issue in one sentence (you have 2 minutes):
user › /cancel
bot › ✅ Conversation cancelled.
bot › 🗑️ Draft ticket discarded.
```

If the user goes silent for two minutes, the bot answers
`⏰ Support session expired. Send "support" to start again.`

## How it works

- **`bot.conversation(name, async (c, ctx) => ...)`** is plain async code:
  it starts when a message matches `name` (or the `trigger` option), `ctx`
  is that message and `c` holds the waits. Use it when the logic does not
  fit a linear `flow()`.
- **`c.waitText({ timeout, validate })`** waits for the next text of the
  same user. A rejected answer sends the `validate` text and waits again.
- **`c.choose(prompt, options)`** sends a numbered menu and resolves with
  the chosen key.
- **Errors end the conversation.** A silent user makes the wait throw
  `ConversationTimeout`; `/cancel` confirms the cancellation itself and makes
  the wait throw `ConversationCancelled`. Catch them to answer or clean up
  (here, discard the draft ticket); without a `catch`, a timeout sends the
  built-in text, which `conversation.timeoutMessage` customizes.
- **Commands always escape.** `/cancel` and `/reset` beat an active
  conversation, so users are never trapped.

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Handoff & access lists](/guide/handoff): pass the chat to a human agent
- [Conversation flows](/guide/flows): retries, idle timers, persistent flows
- [Plugin: rate limiter](./rate-limiter): protect the bot from floods
