# Send Messages

Build a bot that shows every way to answer a text: keywords, regex,
quotes, reactions, sender info and multi-line replies.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Triggers

**Features shown:** [trigger forms](/guide/concepts#when-simple-responses) ·
[reply helpers](/guide/messages#reply-helpers-inside-a-handler) ·
[`ctx.react()`](/guide/messages#react) ·
[`ctx.senderInfo`, `ctx.sender`, `ctx.isGroup`](/guide/concepts#the-ctx-object) ·
[catch-all](/guide/concepts#message-event-vs-onmessage)

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
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // One keyword, or any of a list (whole message, case and accents ignored)
  bot.when('hi', (ctx) => ctx.reply('👋 Hello!'))
  bot.when(['bye', 'goodbye', 'see you'], (ctx) => ctx.reply('👋 See you later!'))

  // The word anywhere in the message
  bot.when({ pattern: 'invoice', match: 'contains' }, (ctx) => ctx.reply('🧾 I see you mentioned an invoice'))

  // Regular expressions
  bot.when(/[\w.]+@[\w.]+\.\w+/, (ctx) => ctx.reply('📧 That looks like an email'))
  bot.when(/\d{4,}/, (ctx) => ctx.reply(`🔢 Detected a long number in "${ctx.body}"`))

  // Quote the user's message, or react to it
  bot.when('quote', (ctx) => ctx.quote('Replying to your exact message'))
  bot.when('good bot', (ctx) => ctx.react('👍'))

  // Who wrote, and where
  bot.when('who', (ctx) =>
    ctx.reply(`You are ${ctx.senderInfo.displayName ?? 'someone'} (${ctx.sender}) in a ${ctx.isGroup ? 'group' : 'private chat'}.`),
  )

  // Multi-line text with WhatsApp-style formatting
  bot.when('info', (ctx) => ctx.reply(['ℹ️ *Bot info*', '', '• Engine: botmesh', '• Works on: WhatsApp, Telegram'].join('\n')))

  bot.onMessage((ctx) => ctx.reply('🤔 I did not recognize that. Try: hi, quote, who, info.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'messages-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "hi" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js --name Ana`:

```text
user › Hi
bot › 👋 Hello!
user › see you
bot › 👋 See you later!
user › can you resend my invoice?
bot › 🧾 I see you mentioned an invoice
user › ana@example.com
bot › 📧 That looks like an email
user › my code is 123456
bot › 🔢 Detected a long number in "my code is 123456"
user › quote
bot › Replying to your exact message
user › good bot
bot › [reaction: 👍]
user › who
bot › You are Ana (user) in a private chat.
user › info
bot › ℹ️ *Bot info*

      • Engine: botmesh
      • Works on: WhatsApp, Telegram
user › hello there
bot › 🤔 I did not recognize that. Try: hi, quote, who, info.
```

## How it works

- **Exact by default.** `bot.when('hi')` matches the whole message after
  normalizing case, accents and spaces: "Hi" matches, "hi there" does not.
- **`match: 'contains'`** (also `'startsWith'` and `'endsWith'`) matches part
  of the message; a **regex** matches anywhere in it.
- **Specificity decides** when several triggers match: exact text beats
  regex, regex beats `contains` (see [Precedence](/guide/triggers#precedence)).
- **`ctx.quote(text)`** replies quoting the incoming message;
  **`ctx.react(emoji)`** reacts to it (channels without reactions skip it).
- **`ctx.senderInfo.displayName`** is the sender's profile name when the
  transport reports one; `ctx.sender` is their stable id, the same in a DM and
  in a group.
- Baileys has no native buttons: for a quick choice use a
  [poll](./poll-bot) or a numbered [menu](./menu-bot).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Media replies](./media): photos, files, locations and contacts
- [FAQ bot](./faq-bot): keyword answers with a fallback
- [Messages & media](/guide/messages): typing indicators, edits, long texts
