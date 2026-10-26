# Order tracking

Build a bot that looks up orders, remembers which ones each user follows, and
offers the last one again next time, even after a restart.

**Level:** Intermediate · **Tags:** WhatsApp, User data, Conversations

**Features shown:**
[user data (`ctx.user`)](/guide/user-data) ·
[namespaces](/guide/user-data#api) ·
[async conversations](/guide/flows#beyond-the-dsl) ·
[validation and `maxAttempts`](/guide/flows#ask) ·
[`MemoryStore` with a file](/guide/store#memorystore) ·
[slash commands](/guide/plugins#built-in-slashcommands)

## Prerequisites

- Node.js 22.12 or newer and an empty folder with `"type": "module"` in its
  `package.json` ([Getting started](/guide/getting-started#_1-install)).
- While botmesh is in prerelease, add the dist-tag from the
  [prerelease note](/guide/getting-started#requirements) to every `@botmesh/*` package.

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, isMainModule, MemoryStore, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Stand-in for your order API
const ORDERS = {
  A100: { item: 'Blue sneakers', status: '🚚 On its way', eta: 'Thursday' },
  B200: { item: 'Rain jacket', status: '📦 Being packed', eta: 'next week' },
  C300: { item: 'Wool socks', status: '✅ Delivered', eta: 'already there' },
}
const findOrder = (code) => ORDERS[code.trim().toUpperCase()]

const createBot = defineBot((provider) => {
  // A store saved to a file: profiles survive a restart (use SQLite or Redis in production)
  const bot = new Bot({ provider, store: new MemoryStore({ file: './orders.json' }) })

  bot.plug(slashCommandsPlugin, {
    greeting: '📦 Send "track" to follow an order, "my orders" to list them. /forget clears your data.',
  })

  // 1. A conversation that reads and writes the user's profile (ctx.user)
  bot.conversation(
    'track',
    async (c, ctx) => {
      const orders = ctx.user.ns('orders') // a namespace just for this feature
      const last = await orders.get('last')

      // 2. Per-user memory: offer the last order instead of asking again
      let code
      if (last && (await c.choose(`Track ${last} again?`, { yes: `Yes, ${last}`, other: 'Another order' })) === 'yes') {
        code = last
      } else {
        const answer = await c.ask('What is your order number? (e.g. A100)', {
          validate: (body) => (findOrder(body) ? true : '🔎 I cannot find that order. Check the number and try again.'),
          maxAttempts: 3,
        })
        code = answer.trim().toUpperCase()
      }

      // 3. Remember it: the last order and every order this user follows
      const followed = (await orders.get('followed')) ?? []
      await orders.update({ last: code, followed: followed.includes(code) ? followed : [...followed, code] })

      const order = findOrder(code)
      await c.say(`${order.status}\n${code} · ${order.item}\nArrives: ${order.eta}`)
    },
    { trigger: ['track', 'where is my order'] },
  )

  bot.when('my orders', async (ctx) => {
    const followed = (await ctx.user.ns('orders').get('followed')) ?? []
    if (followed.length === 0) return ctx.reply('You are not following any order yet. Send "track".')
    await ctx.reply(followed.map((code) => `• ${code}: ${findOrder(code).status}`).join('\n'))
  })

  // 4. Let the user erase what the bot remembers about them
  bot.command('forget', async (ctx) => {
    await ctx.user.ns('orders').clear()
    await ctx.reply('🧹 Done, I forgot your orders.')
  })

  bot.onMessage((ctx) => ctx.reply('Send "track", "my orders" or /help.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'orders-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
  // Ctrl+C: stop the bot so the store writes orders.json before exiting
  process.once('SIGINT', async () => {
    await bot.stop()
    process.exit(0)
  })
}
```

## How it works

1. **A conversation as a function.** `bot.conversation(name, fn, { trigger })`
   is the async form of a flow: plain `if`s and variables decide what to ask.
   Its `ctx` is the full message context, so `ctx.user` works directly.
2. **Per-user memory.** `ctx.user` is a profile keyed by the sender, the same
   in their DM and in every group. `ns('orders')` keeps this feature's keys
   apart from the rest of the profile, and `/forget` clears only them.
3. **Per-conversation state.** `code` and `last` live only while the
   conversation runs; what must outlive it goes to `ctx.user`.
   `orders.update({ last, followed })` writes both keys in one call.
4. **Validation.** `validate` rejects unknown order numbers with a hint, and
   `maxAttempts: 3` ends the conversation after three wrong answers.
5. **Surviving restarts.** `MemoryStore({ file })` saves profiles and
   checkpoints to `orders.json` every minute and when the bot stops, and loads
   them on start. Nothing stops the bot on Ctrl+C by itself, so the start block
   calls `bot.stop()` on `SIGINT`: without it, changes from the last minute
   are lost. Use
   [SQLite or Redis](/guide/store) when several processes share the data.

From outside a handler (a webhook from your shop, a scheduled job) the same
profile is `bot.user(userId)`, for example
`await bot.user(userId).ns('orders').get('followed')` to find who to notify
when an order ships.

## Try it

```bash
npx botmesh dev bot.js --user ana
```

`:as bob` switches to another user (in their own DM), and `:reset` restarts the
bot from the factory:

```text
ana › my orders
bot › You are not following any order yet. Send "track".
ana › track
bot › What is your order number? (e.g. A100)
ana › Z999
bot › 🔎 I cannot find that order. Check the number and try again.
ana › a100
bot › 🚚 On its way
      A100 · Blue sneakers
      Arrives: Thursday
ana › track
bot › Track A100 again?

      1) Yes, A100
      2) Another order
ana › 2
bot › What is your order number? (e.g. A100)
ana › b200
bot › 📦 Being packed
      B200 · Rain jacket
      Arrives: next week
ana › :reset
• ↺ fresh bot — conversations and in-memory state cleared
ana › track
bot › Track B200 again?

      1) Yes, B200
      2) Another order
ana › 1
bot › 📦 Being packed
      B200 · Rain jacket
      Arrives: next week
ana › my orders
bot › • A100: 🚚 On its way
      • B200: 📦 Being packed
ana › :as bob
• you are now "bob" (bob)
bob › my orders
bot › You are not following any order yet. Send "track".
bob › :as ana
• you are now "ana" (ana)
ana › /forget
bot › 🧹 Done, I forgot your orders.
ana › my orders
bot › You are not following any order yet. Send "track".
```

## Run it on WhatsApp or Telegram

`node bot.js` shows a QR code: scan it from **WhatsApp → Linked devices**. For
Telegram, install `@botmesh/telegram` and swap the provider in the start block
for `new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`, as in
[Or connect Telegram](/guide/getting-started#or-connect-telegram).

## Next steps

- [Persistent user data](/guide/user-data): paths, TTLs and privacy (export and erasure)
- [Multi-language bot](./multi-language): the user's language is stored in `ctx.user` too
- [Appointment booking](./appointment-booking): a persistent flow on SQLite
