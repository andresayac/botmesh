# Greeting Bot

Build a bot that welcomes each user once, says hello, repeats what you send
and lists its commands.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Commands

**Features shown:** [`WELCOME` trigger](/guide/triggers#welcome) ·
[text and regex triggers](/guide/concepts#when-simple-responses) ·
[`ctx.pass()`](/guide/concepts#handlers-consume-by-default) ·
[slash commands](/guide/plugins#built-in-slashcommands) ·
[catch-all](/guide/concepts#message-event-vs-onmessage) ·
[terminal simulator](/guide/dev-simulator)

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
import { Bot, WELCOME, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const HELP = [
  '🤖 *What I can do*',
  '• hi: say hello',
  '• echo <text>: I repeat your text',
  '• /id: your id · /ping: am I alive?',
].join('\n')

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // /start /help /reset /cancel /id /ping; /start and /help answer with HELP
  bot.plug(slashCommandsPlugin, { greeting: HELP })

  // First contact only: greet once per user, then let the message go on
  bot.when(WELCOME, async (ctx) => {
    await ctx.reply(`🎉 Welcome to the demo bot, ${ctx.pushName ?? 'friend'}!`)
    ctx.pass()
  })

  // Whole-message match, case and accents ignored
  bot.when(['hi', 'hello', 'hey'], (ctx) =>
    ctx.reply(`👋 Hi ${ctx.pushName ?? 'there'}! Send /help to see what I can do.`),
  )

  // A regex trigger: everything after "echo"
  bot.when(/^echo\s+/i, (ctx) => ctx.reply(`🔁 ${ctx.body.replace(/^echo\s+/i, '')}`))

  // Runs only when nothing above handled the message
  bot.onMessage((ctx) => ctx.reply('🤔 I did not get that. Send /help.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'greeting-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "hi" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js --name Ana`:

```text
user › Hí
bot › 🎉 Welcome to the demo bot, Ana!
bot › 👋 Hi Ana! Send /help to see what I can do.
user › echo Good morning!
bot › 🔁 Good morning!
user › /help
bot › 🤖 *What I can do*
      • hi: say hello
      • echo <text>: I repeat your text
      • /id: your id · /ping: am I alive?
user › /ping
bot › pong 🏓
user › what's up?
bot › 🤔 I did not get that. Send /help.
```

## How it works

- **`WELCOME`** fires on the first message of each user (per chat in a DM,
  per participant in a group) and runs before every other trigger. `ctx.pass()`
  lets the same message continue, so "Hí" also reaches the `hi` handler.
  `/reset` re-arms the welcome.
- **Text triggers** compare the whole message after normalizing it
  (lowercase, accents stripped, spaces collapsed): `'hi'` matches "Hí " but
  not "hi there". A list matches any of its entries.
- **A regex** matches anywhere in the text; `ctx.body` keeps the original
  text, so the echo keeps the user's casing.
- **`slashCommandsPlugin`** adds `/start`, `/help`, `/reset`, `/cancel`, `/id`
  and `/ping`; `greeting` replaces the text of `/start` and `/help`.
- **`bot.onMessage()`** is the catch-all: it only runs when nothing else
  handled the message.

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [FAQ bot](./faq-bot): more trigger forms (contains, regex, lists)
- [Special triggers](/guide/triggers): `WELCOME`, message types and calls
- [Testing](/guide/testing): assert these replies with `createTestBot`
