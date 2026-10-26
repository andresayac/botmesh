# Scheduled daily digest

Send every subscriber a digest at 08:00 in the bot's time zone: a durable cron
task that survives restarts and runs once with several replicas, an opt-in
and opt-out list kept in each user's profile, and a paced broadcast that
respects rate limits.

**Level:** Advanced · **Tags:** Scheduler, Broadcast, Time zones, SQLite, WhatsApp

**Features shown:**
[Durable scheduler](/guide/scheduler#durable-tasks-survive-restarts-one-replica-per-run) (`bot.schedule` with `id`, `missed`, `run.occurrenceKey`, `run.signal`) ·
[Time zones](/guide/scheduler#time-zones) (`scheduler.timeZone`) ·
[Broadcasts](/guide/messages#broadcasts) (`bot.broadcast` with batches, pauses and retries) ·
[User data](/guide/user-data) (`ctx.user`, `bot.user()`) ·
[Persistent store](/guide/store) (`SQLiteStore`, `store.schedules()`) ·
[Rate limiting](/guide/rate-limiting)

## Prerequisites

Node.js 22.12 or newer and an ESM project (`"type": "module"`), as in
[Getting started](/guide/getting-started#requirements). While botmesh is in
prerelease, read the note there about which npm tag to install.

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/sqlite-store better-sqlite3
```

## The complete bot

```js
// bot.js
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const DB_FILE = process.env.DB_FILE ?? './data/digest.db'
const TIME_ZONE = process.env.DIGEST_TZ ?? 'America/Bogota'

const TIPS = {
  Monday: 'Write down the one task that would make this week a good one.',
  Tuesday: 'Reply to the email you have been putting off.',
  Wednesday: 'Take a five-minute walk after lunch.',
  Thursday: 'Stand up and stretch every hour.',
  Friday: 'Plan Monday before you close your laptop.',
  Saturday: 'Call someone you have not talked to in a while.',
  Sunday: 'Rest. The digest will be here tomorrow.',
}

// 1. The digest of one day, built from the slot the task covers (the same text on a re-run)
export function digestFor(date) {
  const weekday = date.toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'long' })
  const day = date.toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'long', day: 'numeric' })
  return `☀️ Your digest for ${weekday}, ${day}\n💡 ${TIPS[weekday]}\nReply STOP to unsubscribe.`
}

const createBot = defineBot((provider) => {
  mkdirSync(dirname(DB_FILE), { recursive: true })
  const store = new SQLiteStore({ file: DB_FILE })
  const bot = new Bot({
    provider,
    store,
    // 2. Durable schedules live in the same SQLite file; cron fields are read in TIME_ZONE
    scheduler: { store: store.schedules(), timeZone: TIME_ZONE },
  })
  bot.plug(slashCommandsPlugin)

  // 3. Opt in and opt out: the choice is stored in the user's profile (ctx.user)
  bot.when('subscribe', async (ctx) => {
    await ctx.user.set('digest', { subscribed: true })
    await ctx.reply(`✅ Subscribed! You will get the digest every day at 08:00 (${TIME_ZONE}). Reply STOP to unsubscribe.`)
  })
  bot.when(['stop', 'unsubscribe'], async (ctx) => {
    await ctx.user.set('digest.subscribed', false)
    await ctx.reply('👋 Unsubscribed. Send "subscribe" to come back.')
  })
  bot.onMessage((ctx) => ctx.reply('Send "subscribe" to get a daily digest at 08:00.'))

  // 4. A durable cron task: stored, run once per day across restarts and replicas
  bot.schedule('0 8 * * *', { id: 'daily-digest', missed: 'run-once' }, async (run) => {
    const chatIds = await pendingSubscribers(bot, run.occurrenceKey)
    const saved = []
    // 5. A paced broadcast: 20 chats per batch, 2 s between batches, back-off on rate limits
    const result = await bot.broadcast(chatIds, digestFor(run.scheduledAt), {
      batchSize: 20,
      delayBetween: '2s',
      retries: 3,
      signal: run.signal,
      // 6. Record each chat as soon as its digest is sent, not at the end
      onProgress: (_done, _total, last) => {
        if (!last.ok) return
        saved.push(bot.user(last.chatId).set('digest.last', run.occurrenceKey)
          .catch((err) => bot.logger.warn({ err }, 'digest.last not saved')))
      },
    })
    await Promise.all(saved)
    // 7. Stopped mid-broadcast (a deploy at 08:00): the pending chats miss today's digest
    if (result.cancelled) bot.logger.warn({ pending: result.pending.length }, 'daily digest cut short')
    bot.logger.info({ sent: result.sent, failed: result.failed }, 'daily digest')
  })
  return bot
})

export default createBot

// 6. Subscribed private chats that have not received this occurrence yet.
//    In a private chat the chat id is the user id, so it reads that user's profile.
async function pendingSubscribers(bot, occurrenceKey) {
  const ids = []
  for (const chat of await bot.getStore().listChats()) {
    if (chat.kind !== 'dm') continue
    const digest = await bot.user(chat.id).get('digest')
    if (digest?.subscribed && digest.last !== occurrenceKey) ids.push(chat.id)
  }
  return ids
}

if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'digest-bot' }))
  process.once('SIGTERM', () => void bot.stop({ drain: true }))
  await bot.start()
}
```

## How it works

### 1. The same text on a re-run

The digest is built from `run.scheduledAt`, the slot the run covers, not
from the wall clock. If the task runs again for the same slot (see step 6),
it produces the same message. Dates are formatted in `TIME_ZONE` with
`toLocaleDateString`, so the weekday is the one in that zone, not the
server's. There is one zone for the whole bot (`DIGEST_TZ`): every subscriber
gets the digest at 08:00 in that zone. For per-user zones, store each
user's zone in `ctx.user` and register one task per zone.

### 2. A durable scheduler in SQLite

`scheduler.store: store.schedules()` stores each durable task's next run in
the same SQLite file as the rest of the bot. `scheduler.timeZone` makes every
cron task read its fields in that IANA zone: `0 8 * * *` is 08:00 in Bogotá
wherever the server runs, and daylight-saving changes follow the
[documented policy](/guide/scheduler#time-zones).

### 3. Opt in, opt out

`subscribe` and `stop` write the user's choice with `ctx.user`, the per-user
profile kept in the store. Nobody gets the digest without asking for it:
unsolicited bulk messages are the fastest way to get a WhatsApp number
banned.

### 4. A durable cron task

The `id` makes the task durable: its next run is stored, a restart keeps the
schedule, and with several replicas only one runs each occurrence (claimed
under a fenced lease). `missed: 'run-once'` sends one digest if the bot was
down at 08:00 instead of skipping the day. Register durable tasks at boot,
like here: only the schedule is stored, never the handler.

### 5. A paced broadcast

`bot.broadcast()` sends one content to many chats without blocking anyone's
inbound queue: 20 chats per batch, a 2-second pause between batches, and up
to 3 retries per chat after a `RateLimitedError` (which pauses every worker).
A failed chat never stops the rest; the result counts `sent`, `failed` and
the chats still `pending` if `run.signal` aborted it (the bot is stopping).

### 6. At least once, without duplicates

A durable task runs **at least once** per occurrence: if the process dies
mid-broadcast, the occurrence runs again. `run.occurrenceKey`
(`daily-digest@2026-03-02T13:00:00.000Z`) is stable per slot. `onProgress`
runs after each chat settles, so the bot stores the key as `digest.last` as
soon as that chat's digest is sent, and a re-run skips the users who already
got that day's digest. Only a chat whose send went out right before the crash,
but whose `digest.last` was not written yet, can get it twice. In a private chat the chat id is the user id,
so `bot.user(chat.id)` reads the right profile; group chats are skipped.

### 7. Stopping during the broadcast

A crash makes the occurrence run again, but a graceful stop does not:
`bot.stop()` aborts `run.signal`, the broadcast returns the chats it did not
reach in `pending`, the handler returns and the scheduler commits the slot
and moves on to tomorrow. Those chats miss that day's digest, which the bot
logs as `daily digest cut short`. Deploy outside the 08:00 window, or send
the `pending` chats yourself if missing a day matters.

## Sample transcript

Captured with `npx botmesh dev bot.js`, with the clock a few seconds before
08:00 in Bogotá on Monday, March 2, 2026. The digest arrives on its own at
08:00:

```text
user › subscribe
bot › ✅ Subscribed! You will get the digest every day at 08:00 (America/Bogota). Reply STOP to unsubscribe.
bot › ☀️ Your digest for Monday, March 2
      💡 Write down the one task that would make this week a good one.
      Reply STOP to unsubscribe.
user › STOP
bot › 👋 Unsubscribed. Send "subscribe" to come back.
user › hello
bot › Send "subscribe" to get a daily digest at 08:00.
```

## Run it on WhatsApp or Telegram

`node bot.js` connects to WhatsApp: scan the QR with the phone that will be
the bot. Set `DIGEST_TZ` (for example `Europe/Madrid`) to change the zone.
For Telegram, install `@botmesh/telegram` and pass
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` instead.

## Next steps

- [Scheduler](/guide/scheduler): every option of durable tasks, catch-up and backends
- [Rate limiting](/guide/rate-limiting): the provider's own limiter and anti-ban advice
- [Production-ready bot](./production-bot): health checks, logs and Docker for this bot
