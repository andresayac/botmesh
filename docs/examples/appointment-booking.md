# Appointment booking

Build a booking bot that asks for a name, a day and a time, validates every
answer, confirms before saving, and picks up where it left off after a restart.

**Level:** Intermediate · **Tags:** WhatsApp, Forms, Persistence, SQLite

**Features shown:**
[persistent flows](/guide/store#persistent-flows) ·
[validation and `maxAttempts`](/guide/flows#ask) ·
[forms](/guide/forms) ·
[menus with `choose`](/guide/flows#dsl-methods) ·
[SQLite store](/guide/store#sqlitestore) ·
[user data (`ctx.user`)](/guide/user-data) ·
[slash commands](/guide/plugins#built-in-slashcommands)

## Prerequisites

- Node.js 22.12 or newer and an empty folder with `"type": "module"` in its
  `package.json` ([Getting started](/guide/getting-started#_1-install)).

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/sqlite-store better-sqlite3
```

`better-sqlite3` is a native module: with pnpm, approve its build script
([Installing better-sqlite3](/guide/store#installing-better-sqlite3)).

## The complete bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin, userOf } from '@botmesh/core'
import { SQLiteStore } from '@botmesh/sqlite-store'
import { BaileysProvider } from '@botmesh/baileys'

const today = () => new Date().toISOString().slice(0, 10)

const createBot = defineBot((provider) => {
  // 1. A SQLite file keeps flows in progress and user data across restarts
  const bot = new Bot({ provider, store: new SQLiteStore({ file: './bookings.db' }) })

  bot.plug(slashCommandsPlugin, {
    greeting: '💈 Hi! Send "book" to book an appointment or "my appointment" to see it. /cancel stops a booking.',
  })

  // 2. The booking flow: persistent, validated, confirmed
  bot.use(
    flow('book')
      .persistent()
      .timeout('10m')
      .ask('📅 Let us book your appointment. What name should I put it under?', 'name', {
        validate: (body) => (body.trim().length >= 2 ? true : '✋ Please type at least 2 letters.'),
        maxAttempts: 3,
      })
      // 3. A form: typed fields, validated one by one (a native WhatsApp Flow on the Cloud API)
      .form(
        {
          id: 'slot',
          fields: [
            { type: 'date', name: 'day', label: 'Day', prompt: 'Which day? (e.g. 2030-03-14)', min: today(), error: '❌ Pick a day from today on.' },
            { type: 'select', name: 'time', label: 'Time', prompt: 'What time?', options: ['09:00', '11:30', '16:00'] },
          ],
        },
        { flatten: true, maxAttempts: 3 },
      )
      // 4. Confirmation before saving anything
      .say((_ctx, c) => `📝 ${c.state.name}, ${c.state.day} at ${c.state.time}.`)
      .choose('Shall I book it?', { yes: 'Yes, book it', no: 'No, cancel' }, 'confirm')
      .do(async (ctx, c) => {
        if (c.state.confirm === 'no') return c.end('👌 Cancelled, nothing was booked.')
        // 5. Save the booking in the user's profile (same SQLite file)
        await userOf(ctx).set('appointment', { name: c.state.name, day: c.state.day, time: c.state.time })
      })
      .say('✅ Booked! Send "my appointment" to see it.'),
  )

  bot.when('my appointment', async (ctx) => {
    const appointment = await ctx.user.get('appointment')
    await ctx.reply(
      appointment
        ? `📅 ${appointment.name}: ${appointment.day} at ${appointment.time}`
        : 'You have no appointment yet. Send "book".',
    )
  })

  bot.onMessage((ctx) => ctx.reply('Send "book", "my appointment" or /help.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'booking-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

1. **The store.** `SQLiteStore` writes chats, flow checkpoints and user data to
   `bookings.db`. Without it the bot uses an in-memory store and forgets
   everything on restart.
2. **A persistent flow.** `.persistent()` saves a checkpoint when the flow
   starts and after every step. After a restart, the user's next message wakes
   the flow and the pending question is asked again: that message is not taken
   as the answer. `.timeout('10m')` ends a booking nobody finishes.
3. **Validation.** `validate` returns `true` or the text to send before asking
   again. `maxAttempts: 3` counts every answer, the first one included; after
   the third wrong answer the conversation ends with the built-in "too many
   attempts" message.
4. **A form.** `.form()` collects typed fields: `date` accepts
   `YYYY-MM-DD` and `DD/MM/YYYY` and checks `min`, `select` shows a numbered
   menu and stores the chosen option. `flatten: true` copies each answer to
   `c.state.day` and `c.state.time`. On the WhatsApp Cloud API the same form
   can go out as one native WhatsApp Flow; everywhere else it is asked field by
   field. A restart in the middle of the form asks it again from its first
   field, because the form is one step.
5. **Confirmation.** `.choose()` stores the chosen key (`yes` or `no`). In the
   `.do()` step, `c.end(text)` stops the flow with a last message, so nothing
   is saved when the user says no.
6. **Saving the booking.** In flow steps `ctx` is a plain runtime message, so
   `userOf(ctx)` gives you the same profile that handlers reach as `ctx.user`.
   `my appointment` reads it back, also after a restart.

`min: today()` is computed when the bot starts. For a bot that runs for days,
check the date again in a `.do()` step, or restart the bot daily.

## Try it

```bash
npx botmesh dev bot.js
```

`:reset` in the simulator builds a fresh bot from the factory, which is what a
restart does: the new `SQLiteStore` opens the same file and the flow resumes.

```text
user › my appointment
bot › You have no appointment yet. Send "book".
user › book
bot › 📅 Let us book your appointment. What name should I put it under?
user › A
bot › ✋ Please type at least 2 letters.
user › Ana Gómez
bot › Which day? (e.g. 2030-03-14)
user › :reset
• ↺ fresh bot — conversations and in-memory state cleared
user › hello?
bot › Which day? (e.g. 2030-03-14)
user › 2020-01-01
bot › ❌ Pick a day from today on.
user › 2030-03-14
bot › What time?

      1) 09:00
      2) 11:30
      3) 16:00
user › 7
bot › ❌ Pick an option from the list (number or option).
user › 2
bot › 📝 Ana Gómez, 2030-03-14 at 11:30.
bot › Shall I book it?

      1) Yes, book it
      2) No, cancel
user › 1
bot › ✅ Booked! Send "my appointment" to see it.
user › my appointment
bot › 📅 Ana Gómez: 2030-03-14 at 11:30
```

## Run it on WhatsApp or Telegram

`node bot.js` shows a QR code: scan it from **WhatsApp → Linked devices**. For
Telegram, install `@botmesh/telegram` and swap the provider in the start block
for `new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`, as in
[Or connect Telegram](/guide/getting-started#or-connect-telegram).

## Next steps

- [Forms (WhatsApp Flows)](/guide/forms): every field type and the native form on the Cloud API
- [Persistent store](/guide/store): Redis, Postgres and what each table holds
- [Human handoff](./human-handoff): let a person take over a chat
