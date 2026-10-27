# WhatsApp and Telegram at once

Run one bot on two channels from the same file: one factory, two providers,
two `Bot` instances in one process, one SQLite database.

**Level:** Intermediate · **Tags:** WhatsApp, Telegram, Multi-channel, SQLite

**Features shown:**
[the bot factory (`defineBot`)](/guide/dev-simulator#_1-the-factory-pattern-definebot) ·
[channels](/guide/channels) ·
[chat and sender ids](/guide/concepts#chat-and-sender-ids) ·
[identity per transport](/guide/messages#identity-per-transport) ·
[storage namespace](/guide/configuration#identity-and-storage-namespace) ·
[SQLite store](/guide/store#sqlitestore) ·
[user data (`ctx.user`)](/guide/user-data)

## Prerequisites

- Node.js 22.12 or newer and an empty folder with `"type": "module"` in its
  `package.json` ([Getting started](/guide/getting-started#_1-install)).
- A Telegram bot token from [@BotFather](https://t.me/BotFather) and a phone
  with WhatsApp for the bot's number.

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/telegram @botmesh/sqlite-store better-sqlite3
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin, userOf } from '@botmesh/core'
import { SQLiteStore } from '@botmesh/sqlite-store'
import { BaileysProvider } from '@botmesh/baileys'
import { TelegramProvider } from '@botmesh/telegram'

// 1. One factory, called once per channel: each call builds its own Bot
const createBot = defineBot((provider) => {
  const bot = new Bot({
    provider,
    // 2. One database file for every channel. Each bot gets its own store instance
    //    and keeps its rows apart: the namespace includes the provider id
    store: new SQLiteStore({ file: './bot.db' }),
  })

  bot.plug(slashCommandsPlugin, { greeting: '👋 Send "whoami", "signup" or /id.' })

  // 3. Ids are opaque strings chosen by each channel: show and store them, never parse them
  bot.when('whoami', async (ctx) => {
    const { name, visits = 0 } = await ctx.user.all()
    await ctx.user.set('visits', visits + 1)
    await ctx.reply(`📡 ${provider.id} · chat ${ctx.from} · user ${ctx.sender}\n👤 ${name ?? 'no name yet'} · visit ${visits + 1}`)
  })

  // 4. Flows, commands and user data work the same on every channel
  bot.use(
    flow('signup')
      .ask('What is your name?', 'name')
      .do(async (ctx, c) => {
        await userOf(ctx).set('name', c.state.name)
      })
      .say((_ctx, c) => `✅ Saved, ${c.state.name}.`),
  )

  bot.onMessage((ctx) => ctx.reply('Send "whoami", "signup" or /help.'))

  return bot
})

export default createBot

// 5. Production: the same factory, two providers, two bots in one process
if (isMainModule(import.meta)) {
  const whatsapp = await createBot(new BaileysProvider({ session: 'multi-bot' }))
  const telegram = await createBot(new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' }))
  whatsapp.on('ready', () => console.log('✅ WhatsApp connected'))
  telegram.on('ready', () => console.log('✅ Telegram connected'))
  await Promise.all([whatsapp.start(), telegram.start()])

  process.once('SIGINT', async () => {
    await Promise.all([whatsapp.stop(), telegram.stop()])
    process.exit(0)
  })
}
```

## How it works

1. **One factory, many bots.** `defineBot` returns a function that builds a
   bot around the provider it receives. The start block calls it twice, once
   per channel, so both bots run the same handlers, flows and commands. The
   simulator calls it once with its own provider.
2. **One database file.** Each bot gets its own `SQLiteStore` instance on the
   same `bot.db`. Do not pass one store instance to two bots: `bot.stop()`
   closes its store, and the other bot would lose it. Everything a bot writes
   is namespaced by its bot id, which defaults to the provider id (`baileys`,
   `telegram`), so the two bots never read each other's rows. Set `session`,
   `botId` or `tenantId` on the `Bot` when you run several bots of the same
   channel ([storage namespace](/guide/configuration#identity-and-storage-namespace)).
3. **Ids are opaque.** Each channel picks its own id format. Store and compare
   them as they arrive; never parse a phone number out of them.
4. **Ids are stable.** The provider resolves aliases before your code sees a
   message: on WhatsApp the same person arrives with the same `ctx.sender`
   even when WhatsApp switches between their phone number and their LID. So
   `ctx.user`, conversations and access lists keep working.
5. **Separate profiles.** The same person on WhatsApp and on Telegram is two
   users with two profiles. To link them, store your own mapping (for
   example a code the user sends from both channels).
6. **Stopping.** On `Ctrl+C` both bots stop, which closes their connections
   and their database handles.

What `whoami` prints for the same person on each channel:

| Channel | Chat | `ctx.from` | `ctx.sender` |
| --- | --- | --- | --- |
| WhatsApp (`baileys`) | DM | `573001234567@s.whatsapp.net` | `573001234567@s.whatsapp.net` |
| WhatsApp (`baileys`) | group | `120363025555555555@g.us` | `573001234567@s.whatsapp.net` |
| Telegram (`telegram`) | DM | `123456789` | `123456789` |
| Telegram (`telegram`) | group | `-1001234567890` | `123456789` |

In a DM the chat is the user; in a group the chat is the group and the sender
is the member who wrote.

## Try it

The simulator runs one bot with its in-memory provider (`mock`). The
database is the same `bot.db`, so `:reset` (a fresh bot from the factory)
still finds the profile:

```bash
npx botmesh dev bot.js --user ana
```

```text
ana › whoami
bot › 📡 mock · chat ana · user ana
      👤 no name yet · visit 1
ana › signup
bot › What is your name?
ana › Ana
bot › ✅ Saved, Ana.
ana › whoami
bot › 📡 mock · chat ana · user ana
      👤 Ana · visit 2
ana › :reset
• ↺ fresh bot — conversations and in-memory state cleared
ana › whoami
bot › 📡 mock · chat ana · user ana
      👤 Ana · visit 3
```

## Run it on both channels

Put the token in `.env` (`TELEGRAM_TOKEN=123456:ABC-your-token`), then:

```bash
node --env-file=.env bot.js
```

Scan the QR from **WhatsApp → Linked devices**, and write to your Telegram
bot. Send `signup` on one channel and `whoami` on the other: the name is
only on the first one.

## Next steps

- [Channels](/guide/channels): what each transport supports, and the Cloud API (`@botmesh/meta`) as a third provider
- [Running N replicas](/guide/replicas): several processes for the same bot
- [Group bot](./group-bot): what the group ids above are used for
