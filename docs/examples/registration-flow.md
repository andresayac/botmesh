# Registration Flow

Build a sign-up conversation that asks for name, email and age, validates
each answer, saves the result and shows it back on request.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Flows, Forms

**Features shown:** [`flow()` DSL](/guide/flows#basic-flow) ·
[`.ask()` with `validate`](/guide/flows#ask) ·
[`.do()` actions](/guide/flows#dsl-methods) ·
[`c.state`](/guide/flows#typed-state) ·
[`.timeout()`](/guide/flows#dsl-methods) ·
[`/cancel` escapes a flow](/guide/plugins#built-in-slashcommands)

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
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })
  const users = new Map() // replace with your database

  // /cancel and /reset leave any flow
  bot.plug(slashCommandsPlugin)

  bot.use(
    flow('register')
      .say('📝 *Let us register you*')
      .ask('What is your name?', 'name', {
        validate: (body) => (body.trim().length >= 2 ? true : '❌ At least 2 letters, please.'),
      })
      .ask('What is your email?', 'email', {
        validate: (body) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Invalid email. Try again.'),
      })
      .ask('How old are you?', 'age', {
        validate: (body) => (/^\d+$/.test(body) && Number(body) >= 18 ? true : '❌ You must be 18 or older (numbers only).'),
      })
      .do((ctx, c) => {
        users.set(ctx.sender, { name: c.state.name, email: c.state.email, age: Number(c.state.age) })
      })
      .say((_ctx, c) => ['✅ *Registration complete!*', '', `👤 ${c.state.name}`, `📧 ${c.state.email}`, `🎂 ${c.state.age}`].join('\n'))
      .timeout('5m'),
  )

  bot.when('profile', (ctx) => {
    const user = users.get(ctx.sender)
    return ctx.reply(user ? `👤 ${user.name} · 📧 ${user.email} · 🎂 ${user.age}` : 'You are not registered yet. Send "register".')
  })

  bot.onMessage((ctx) => ctx.reply('Send "register" to sign up or "profile" to see your data.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'register-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "register" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`:

```text
user › profile
bot › You are not registered yet. Send "register".
user › register
bot › 📝 *Let us register you*
bot › What is your name?
user › A
bot › ❌ At least 2 letters, please.
user › Ana
bot › What is your email?
user › ana@
bot › ❌ Invalid email. Try again.
user › ana@example.com
bot › How old are you?
user › 16
bot › ❌ You must be 18 or older (numbers only).
user › 30
bot › ✅ *Registration complete!*

      👤 Ana
      📧 ana@example.com
      🎂 30
user › profile
bot › 👤 Ana · 📧 ana@example.com · 🎂 30
user › register
bot › 📝 *Let us register you*
bot › What is your name?
user › /cancel
bot › ✅ Conversation cancelled.
```

## How it works

- **`.ask(text, key, { validate })`** sends the question, waits for the
  answer and stores it in `c.state[key]`. `validate` returns `true` to
  accept, or the text to send before waiting again.
- **`.do((ctx, c) => ...)`** runs code without sending anything: here it
  saves the user under `ctx.sender`, their stable id on every channel.
- **`.say((ctx, c) => ...)`** builds the summary from everything captured.
- **`.timeout('5m')`** ends a flow the user abandoned; the bot-wide
  `conversation.timeoutMessage` sets what is sent then.
- **Commands win.** `/cancel` (from `slashCommandsPlugin`) leaves the flow
  even while it waits for an answer.

## Variations

Validate with a schema instead: `schema` takes any zod-compatible object,
and the **parsed** value lands in `c.state` (a `number` below):

```js
import { z } from 'zod'

flow('register')
  .ask('What is your name?', 'name', { schema: z.string().trim().min(2, '❌ At least 2 letters') })
  .ask('How old are you?', 'age', { schema: z.coerce.number().int().min(18, '❌ You must be 18 or older') })
  .say((_ctx, c) => `✅ ${c.state.name}, ${c.state.age} years old`)
```

To keep the data across restarts, store it with
[persistent user data](/guide/user-data) instead of a `Map`. For several
fields in one native form on the WhatsApp Cloud API, see
[Forms](/guide/forms).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Shopping flow](./shopping-flow): menus, sub-flows and `goto`
- [Conversation flows](/guide/flows): the whole flow DSL
- [Testing](/guide/testing): assert this flow with `createTestBot`
