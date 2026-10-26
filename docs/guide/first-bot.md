# Your First Bot

This page grows the bot from [Getting started](./getting-started) into one
that handles commands, media, a poll and a multi-step flow with validation.
It runs unchanged in the terminal simulator and on WhatsApp.

## The complete bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  // 1. The bot: transport-agnostic engine + the provider you receive
  const bot = new Bot({ provider })

  // 2. Built-in slash commands
  bot.plug(slashCommandsPlugin, {
    greeting: '🤖 Hi! Try: hi, photo, poll, register. Commands: /help /reset /cancel /id /ping',
  })

  // 3. Simple replies
  bot.when(['hi', 'hello'], (ctx) => ctx.reply(`👋 Hello ${ctx.pushName ?? 'there'}! Send "register" to try a flow.`))

  // 4. Media and polls
  bot.when('photo', (ctx) => ctx.photo('https://picsum.photos/400/300', '📸 Here is a photo'))
  bot.when('poll', (ctx) => ctx.poll('Favourite colour?', ['Red', 'Green', 'Blue']))

  // 5. A multi-step flow with validation and a menu
  bot.use(
    flow('register')
      .say('📝 *Let us register you*')
      .ask('What is your name?', 'name')
      .ask('What is your email?', 'email', {
        validate: (body) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ That is not an email, try again'),
      })
      .choose('Do you want our newsletter?', { yes: 'Yes, please', no: 'No, thanks' }, 'newsletter')
      .say((_ctx, c) =>
        `✅ Done!\n👤 ${c.state.name}\n📧 ${c.state.email}\n📰 Newsletter: ${c.state.newsletter}`,
      )
      .timeout('5m'),
  )

  // 6. Catch-all: runs only when nothing else handled the message
  bot.onMessage((ctx) => ctx.reply('🤔 I did not get that. Send /help for commands.'))

  return bot
})

export default createBot

// 7. Start: `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'my-bot' }))
  bot.on('qr', () => console.log('📱 Scan the QR with WhatsApp → Linked devices'))
  bot.on('ready', () => console.log('✅ Bot ready'))
  await bot.start()
}
```

## Try it

```bash
npx botmesh dev bot.js     # in the terminal, no phone
node bot.js                # on WhatsApp: scan the QR, then write from another phone
```

```text
user › register
bot › 📝 *Let us register you*
bot › What is your name?
user › Ana
bot › What is your email?
user › nope
bot › ❌ That is not an email, try again
user › ana@example.com
bot › Do you want our newsletter?

      1) Yes, please
      2) No, thanks
user › 1
bot › ✅ Done!
      👤 Ana
      📧 ana@example.com
      📰 Newsletter: yes
```

Send `/reset` in the middle of the flow to leave it: commands always win over
an active conversation.

## What each part does

### 1. The bot and its provider

`new Bot({ provider })` wires the transport-agnostic engine to a transport.
Transport options live on the provider: `session: 'my-bot'` saves the WhatsApp
login in `./sessions/my-bot/`, so later starts reconnect without a QR.
`defineBot` and `isMainModule` let the simulator inject its own provider
instead of `BaileysProvider` (see [Terminal simulator](./dev-simulator)).

The texts the framework writes for you (slash command replies, "please answer
with text", timeouts) are in English by default. `new Bot({ provider, lang: 'es' })`
switches them to the bundled Spanish texts; [Internationalization](./i18n)
covers several languages.

### 2. Slash commands

`slashCommandsPlugin` installs `/start`, `/help`, `/reset`, `/cancel`, `/id`
and `/ping`. `greeting` replaces the text of `/start` and `/help`, so list
your commands in it; without `greeting` both answer with the built-in command
list. Commands win over an active conversation, so `/reset` or `/cancel`
always escapes a flow.

### 3. Simple replies

`bot.when(trigger, handler)` compares the **whole** message, normalized
(lowercase, accents stripped, spaces collapsed): `'hi'` matches "hi" and
"Hí ", not "hi there". A list matches any of its entries. Use
`{ pattern: 'hi', match: 'contains' }` for substring matching, or a regex.
`ctx.pushName` is the sender's display name when the transport reports one.
See [Special triggers](./triggers) for every trigger form.

### 4. Media and polls

Every `ctx` send method takes a URL, a local path or a `Buffer`:

```js
await ctx.photo('https://example.com/cat.jpg', 'caption')
await ctx.video('./clip.mp4')
await ctx.file('./invoice.pdf')
await ctx.voice('./note.mp3')                       // voice note (Baileys converts it with ffmpeg)
await ctx.sticker('./logo.png', { pack: 'My bot', author: 'me' })   // Baileys needs `sharp`
await ctx.location(4.711, -74.0721, 'Bogotá')
await ctx.contact('+573001234567', 'Support')
await ctx.poll('Favourite colour?', ['Red', 'Green', 'Blue'])
await ctx.react('👍')
```

What each transport supports natively, and how the rest degrades, is in
[Messages & media](./messages) and [Channels](./channels).

### 5. Flows

`flow('register')` compiles to a real conversation. `.ask(text, key)` sends
`text`, waits for the reply and stores it in `c.state[key]`; `validate`
returns `true` or the text to send before asking again. `.choose()` sends a
numbered menu and stores the chosen **key** (the user can answer with the
number or the label). The function form of `.say((ctx, c) => ...)` reads everything
captured so far, and `.timeout('5m')` ends an abandoned conversation. The flow
starts when a message matches its trigger (`register`). More in
[Conversation flows](./flows).

### 6. Catch-all

`bot.onMessage()` runs only when nothing else (a command, an active
conversation, a `when` handler or a flow trigger) consumed the message.

### 7. Start

`bot.on('qr')` fires when the provider needs you to authenticate (a QR string
on Baileys); `bot.on('ready')` fires once the transport is connected. After
`await bot.start()` the bot can send; before it, sends reject with
`BotNotRunningError`.

## Next steps

- [Core concepts](./concepts): how a message is routed, `ctx`, ids and options
- [Conversation flows](./flows): branching, retries, persistent flows
- [Testing](./testing): assert this flow in a unit test with `createTestBot`
- [Examples](/examples/): more recipes
