# Proactive messages

Most bot code answers a message. This page gathers the ways a bot **writes
first**: a one-off send, a broadcast, a flow started from code, scheduled jobs
and inactivity follow-ups. Each section has a short example and links to the
page with every option.

| You want to | Use |
| --- | --- |
| Send one message to one chat | [`bot.send()`](#send-to-one-chat) |
| Send the same message to many chats | [`bot.broadcast()`](#broadcast-to-many-chats) |
| Start a flow or conversation for someone who has not written | [`bot.trigger()`](#start-a-flow-from-code) |
| Run code on a timetable (cron, interval, once) | [`bot.schedule()`, `bot.every()`, `bot.delay()`](#scheduled-jobs) |
| Follow up when a chat goes quiet | [`bot.onIdle()`](#follow-up-on-inactivity) |
| Survive a crash between "decided to send" and "sent" | [`bot.enqueue()`](#durable-sends) |

## Send to one chat

`bot.send(chatId, content, options?)` sends to any chat from anywhere (a job, a
webhook, an admin panel). A string is sent as text; anything else is the
transport-neutral content union (`{ kind, ... }`). It runs the
`before('send')` / `after('send')` hooks like a reply from a handler.

```ts
await bot.send(chatId, '🌅 Good morning!')
await bot.send(chatId, { kind: 'image', media: { url }, caption: 'Today’s menu' })
```

It resolves a `SentMessage` (`{ ref, id, chatId, raw, skipped? }`); `skipped` is
set when a `before('send')` hook aborted the send. `chatId` is the opaque id the
channel uses (store the `ctx.from` of an earlier message). See
[Sending outside a handler](./messages#sending-outside-a-handler).

## Broadcast to many chats

`bot.broadcast(chatIds, content, options?)` sends one content to many chats in
batches, without holding the per-chat inbound queues:

```ts
const res = await bot.broadcast(chatIds, '🎉 New promo!', { batchSize: 10, delayBetween: '2s' })
// → { total, sent, failed, skipped, errors, messages, cancelled, pending }
```

A `RateLimitedError` pauses the whole broadcast and retries that chat; other
errors are recorded and the broadcast goes on. From inside a handler, launch it
with `void bot.broadcast(...)`. Every option (`concurrency`, `retries`,
`signal`, `onProgress`, `onFail`…) is in [Broadcasts](./messages#broadcasts).

## Start a flow from code

`bot.trigger(name, { chatId, userId?, isGroup?, data?, ifActive?, body? })`
starts a registered flow or `bot.conversation` without an inbound message. The
user's replies then reach it as usual. `data` seeds `c.state`:

```ts
const reminder = flow('reminder')
  .say((_ctx, c) => `Reminder: your appointment is at ${c.state.time}.`)
  .ask('Reply *yes* to confirm.', 'answer')
bot.registerFlow(reminder)

const result = await bot.trigger('reminder', { chatId, data: { time: '15:00' } })
if (!result.started) bot.logger.info({ reason: result.reason }, 'reminder not started')
```

It goes through the access lists, the handoff gate and the chat's FIFO queue,
and resolves `{ started, name, chatId, userId, reason? }` once the conversation
is entered (not when it ends). A subject that already has a conversation is
left alone (`reason: 'busy'`) unless you pass `ifActive: 'replace'`.
`bot.triggerFlow()` is a deprecated wrapper over it. Details in
[Starting a flow programmatically](./messages#starting-a-flow-programmatically).

## Scheduled jobs

The bot has a scheduler for code that runs on a timetable. Each call returns a
`ScheduledTask` whose `cancel()` stops it:

```ts
bot.schedule('0 9 * * 1-5', { timeZone: 'America/Bogota' }, async () => {
  for (const appt of await db.appointmentsToday()) {
    await bot.trigger('reminder', { chatId: appt.chatId, data: { time: appt.time } })
  }
})

const poll = bot.every('10m', () => syncOrders())   // interval: a duration or ms
bot.delay('30s', () => bot.send(adminChat, 'Bot is up'))  // once
poll.cancel()
```

These tasks live in memory: a restart forgets them. Give a task an `id` to make
it **durable** (stored schedule, missed-run policy, one replica per run). See
[Scheduler & durable tasks](./scheduler).

## Follow up on inactivity

`bot.onIdle(duration, handler)` runs once when a chat stays quiet for
`duration` after its last processed message; `ctx` is that message's context,
so `ctx.reply()` answers in the right chat:

```ts
const off = bot.onIdle('10m', async (ctx) => {
  await ctx.reply('Still there? 👀')
})
// off() stops watching; bot.clearIdle(chatId) cancels a chat's pending timer
```

A new message from the chat re-arms it, and it never fires for a chat in human
handoff. For a timeout **inside** a conversation (an `ask` the user does not
answer), use `c.idle()` or `.timeout()` instead. See
[`bot.onIdle()`: inactivity per chat](./flows#bot-onidle-inactivity-per-chat).

## Durable sends

With `BotConfig.durability` on, `bot.enqueue(chatId, content, options?)`
journals the send and returns its outbox key at once; a background sweeper
delivers it with retries and a dead-letter queue. An `idempotencyKey` that
already exists is a no-op, which makes jobs that may run twice safe:

```ts
await bot.enqueue(chatId, 'Your appointment is tomorrow at 9', {
  idempotencyKey: `reminder:${appointment.id}`,
})
```

See [Retries, deferral and the dead-letter queue](./durability#retries-deferral-and-the-dead-letter-queue).

## Channel limits

Not every channel lets a bot write first:

- **WhatsApp Cloud API, Twilio and Gupshup (WhatsApp):** outside the 24-hour
  customer-service window a free-form message rejects with
  `OutsideSessionWindowError`; reopen the chat with an approved template. See
  [24-hour window and pricing](./session-window).
- **Messenger:** after the 24-hour window, send with a message tag (see
  [Messenger](./messenger)).
- **TikTok** (experimental): the bot cannot start a conversation.
- **Baileys (WhatsApp Web):** unsolicited bulk messages are the fastest way to
  get a number banned. Keep the [rate limiter](./rate-limiting) on and pace
  broadcasts with `delayBetween`.

## Next steps

- [Messages & media](./messages): every content kind `bot.send()` accepts.
- [Scheduler & durable tasks](./scheduler): cron syntax, time zones and durable tasks.
- [Durable processing](./durability): the inbox/outbox journals behind `bot.enqueue()`.
- [Example: reminder bot](/examples/reminders) and [scheduled daily digest](/examples/daily-digest).
