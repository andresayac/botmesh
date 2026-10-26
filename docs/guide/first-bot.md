# Your First Bot

Let's build a complete bot with commands, media and a conversation flow.

## The complete bot

```ts
import { Bot, flow, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// 1. Create the bot — transport options live on the provider
const bot = new Bot({
  provider: new BaileysProvider({
    session: 'demo-bot',
    sessionsDir: './sessions',
    qr: { terminal: true, small: true },
    markOnlineOnConnect: false,
    ignoreNewsletters: true,
    ignoreBroadcasts: true,
  }),
})

// 2. Connection events
bot.on('ready', () => console.log('✅ Bot ready!'))
bot.on('qr', () => console.log('📱 Scan the QR with your WhatsApp'))

// 3. Built-in slash commands (/start, /help, /reset, /cancel, /id, /ping)
bot.plug(slashCommandsPlugin, {
  // Shown on /start and /help (without it: the built-in command list)
  greeting: [
    '🤖 Hi! I am a bot.',
    'Commands: /help /reset /cancel /id /ping',
    'Or send: hola, photo, sticker, registrar',
  ].join('\n'),
})

// 4. Simple responses
bot.when('hola', async (ctx) => {
  await ctx.reply('👋 Hello! Send "registrar" to try the registration flow.')
})

bot.when('info', async (ctx) => {
  await ctx.reply('ℹ️ I am a bot built with @botmesh/core v2')
})

// 5. Media
bot.when('photo', async (ctx) => {
  await ctx.photo('https://picsum.photos/400/300', '📸 Here is a photo')
})

bot.when('sticker', async (ctx) => {
  await ctx.sticker('https://picsum.photos/512/512', {
    pack: 'My Bot',
    author: 'me',
  })
})

// 6. Registration flow
const register = flow('registrar')
  .say('📝 *Let us register you*')
  .ask('What is your name?', 'name')
  .ask('What is your email?', 'email', {
    validate: (body) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Invalid email, try again',
  })
  .say((_ctx, c) => `✅ Registration complete!\n👤 ${c.state.name}\n📧 ${c.state.email}`)

bot.use(register)

// 7. Catch-all
bot.onMessage(async (ctx) => {
  await ctx.reply('🤔 I did not recognize that. Send /help for commands.')
})

// 8. Start
await bot.start()
```

## What each part does

### 1. Create the bot

`new Bot({ provider })` wires the transport-agnostic engine to a concrete
transport. `session` is a **provider** option: the WhatsApp login is saved
in `./sessions/demo-bot/`. If you close and reopen, **you don't need to
scan the QR again**.

The texts the framework writes for you (slash command replies, "please answer
with text", timeouts...) are in English by default. `lang: 'es'` switches them
to the bundled Spanish texts. See [Internationalization](./i18n) to serve
several languages.

### 2. Connection events

Events that fire when the bot connects or shows the QR. `bot.on('qr', ...)`
receives the provider's auth artifact (a QR string for Baileys — other
transports may surface a pairing code or OAuth URL through the same event).

### 3. Slash commands

Installs `/start`, `/help`, `/reset`, `/cancel`, `/id`, `/ping` — 6 commands
for free. `greeting` replaces the text of `/start` and `/help`, so list the
commands in it (without `greeting` they answer with a built-in command list). Commands always win over an active conversation, so `/reset` (or
`/cancel`) can always escape a stuck flow.

### 4. Simple responses

`bot.when(trigger, handler)` matches by **normalized equals by default**
(lowercased, accents stripped, spaces collapsed) — `'hola'` matches only an
exact "hola"/"Hóla ", not "hola amigo". Use
`{ pattern: 'hola', match: 'contains' }` if you want substring matching.

### 5. Media

```ts
await ctx.photo(url, 'caption')
await ctx.sticker(url, { pack, author })
await ctx.voice(url)
await ctx.location(lat, lng, name)
await ctx.contact(phone, name)
await ctx.poll(question, options)
```

### 6. Flows

Multi-step conversations. `flow('registrar')` compiles to a real conversation:
`.ask(text, key)` sends `text`, waits for the reply, and stores it in
`c.state[key]`. The function form of `.say((ctx, c) => ...)` can read
whatever was captured so far via `c.state`.

### 7. Catch-all

`bot.onMessage()` runs only when nothing else (a command, an active
conversation, or a `when`/flow matcher) already consumed the message.

## Run

```bash
node bot.js
```

Scan the QR and try sending: `hola`, `photo`, `sticker`, `registrar`.

## Next steps

- [Core concepts](./concepts) — understand how it works internally
- [Conversation flows](./flows) — complex conversations
- [Examples](/examples/messages) — more recipes
