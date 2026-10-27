# Reminder Bot

Build a bot that sets one-off reminders ("remind 10m call mom") and sends a
daily tip at 9:00 to everyone who subscribes.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Scheduler

**Features shown:** [`bot.delay()`](/guide/scheduler) ·
[`bot.schedule()` with cron and time zone](/guide/scheduler) ·
[cancelling a task](/guide/scheduler#cancelling-a-task) ·
[`bot.send()` outside a handler](/guide/messages#sending-outside-a-handler) ·
[regex triggers](/guide/concepts#when-simple-responses)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements)). Then install:

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
  const pending = new Map() // chat id → Set of pending reminder tasks
  const subscribers = new Set() // chat ids that get the daily tip

  // "remind 10m call mom": a one-off task with bot.delay()
  bot.when(/^remind\s/i, async (ctx) => {
    const match = /^remind\s+(\d+[smhd])\s+(.+)$/i.exec(ctx.body)
    if (!match) return ctx.reply('Usage: remind <10s|5m|2h|1d> <text>')
    const [, wait, text] = match
    const chatId = ctx.from
    const tasks = pending.get(chatId) ?? new Set()
    pending.set(chatId, tasks)
    const task = bot.delay(wait, async () => {
      tasks.delete(task)
      await bot.send(chatId, `⏰ Reminder: ${text}`)
    })
    tasks.add(task)
    await ctx.reply(`👍 I will remind you in ${wait}.`)
  })

  bot.when('reminders', (ctx) => ctx.reply(`📋 Pending reminders: ${pending.get(ctx.from)?.size ?? 0}`))

  bot.when('cancel reminders', async (ctx) => {
    const tasks = pending.get(ctx.from) ?? new Set()
    for (const task of tasks) task.cancel()
    await ctx.reply(`🗑️ Cancelled ${tasks.size} reminder(s).`)
    tasks.clear()
  })

  // Every day at 9:00, Bogota time, wherever the server runs
  bot.schedule('0 9 * * *', { timeZone: 'America/Bogota' }, async () => {
    for (const chatId of subscribers) await bot.send(chatId, '☀️ Tip of the day: drink a glass of water.')
  })
  bot.when('daily on', (ctx) => {
    subscribers.add(ctx.from)
    return ctx.reply('☀️ Subscribed: a tip every day at 9:00 (Bogota time).')
  })
  bot.when('daily off', (ctx) => {
    subscribers.delete(ctx.from)
    return ctx.reply('👋 Unsubscribed from the daily tip.')
  })

  bot.onMessage((ctx) => ctx.reply('Try: remind 10m call mom · reminders · cancel reminders · daily on'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'reminder-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "remind 1m test" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`; the first reminder arrives two
seconds later:

```text
user › remind 2s stretch your legs
bot › 👍 I will remind you in 2s.
bot › ⏰ Reminder: stretch your legs
user › remind 1h call mom
bot › 👍 I will remind you in 1h.
user › reminders
bot › 📋 Pending reminders: 1
user › cancel reminders
bot › 🗑️ Cancelled 1 reminder(s).
user › remind tomorrow
bot › Usage: remind <10s|5m|2h|1d> <text>
user › daily on
bot › ☀️ Subscribed: a tip every day at 9:00 (Bogota time).
```

## How it works

- **`bot.delay(duration, fn)`** runs `fn` once after `duration` (`'10s'`,
  `'5m'`, `'2h'`, `'1d'` or milliseconds) and returns a task with
  `cancel()`. The handler keeps each task to list or cancel it later.
- **`bot.send(chatId, text)`** sends outside a handler: by the time the
  reminder fires, the message that created it is long gone, so the chat id
  (`ctx.from`) is saved first.
- **`bot.schedule(cron, { timeZone }, fn)`** runs on a 5-field cron
  expression read in an IANA time zone. `bot.every('30m', fn)` repeats at a
  fixed interval instead.
- **In memory.** These tasks live in the process: a restart forgets them.
  To survive restarts (and run once across several replicas), give a task an
  `id` and a schedule store: see
  [Durable tasks](/guide/scheduler#durable-tasks-survive-restarts-one-replica-per-run).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. On
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Scheduler](/guide/scheduler): `every`, cron syntax, daylight-saving rules
- [Persistent user data](/guide/user-data): remember subscribers across restarts
- [Greeting bot](./greeting-bot): add `/help` and a welcome message
