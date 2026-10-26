# Poll Bot

Build a bot that sends native polls, answers each vote with the live tally
and reacts to messages with emoji.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Polls, Reactions

**Features shown:** [`ctx.poll()`](/guide/messages#buttons-normalized-degraded-per-transport) ·
[poll votes (`bot.on('poll')`)](/guide/messages#poll-votes) ·
[`bot.send()` outside a handler](/guide/messages#sending-outside-a-handler) ·
[`ctx.react()`](/guide/messages#react) ·
[terminal simulator `:click`](/guide/dev-simulator#_3-commands-inside-the-simulator)

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
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // Single choice
  bot.when('vote', (ctx) => ctx.poll('What should we eat tonight?', ['🍕 Pizza', '🍣 Sushi', '🥗 Salad']))

  // Multiple choice: third argument `true`
  bot.when('days', (ctx) => ctx.poll('Which days can you come?', ['Monday', 'Wednesday', 'Friday'], true))

  // Every vote arrives here with the current tally of the whole poll
  bot.on('poll', async (vote) => {
    const picked = vote.options.filter((o) => o.voters?.includes(vote.senderId)).map((o) => o.name)
    const tally = vote.options.map((o) => `${o.name}: ${o.votes}`).join(' · ')
    await bot.send(vote.ref.chatId, picked.length ? `🗳️ You picked ${picked.join(', ')}\n📊 ${tally}` : '🗳️ Vote withdrawn')
  })

  // React to the user's message instead of replying
  bot.when(['thanks', 'thank you', 'great'], (ctx) => ctx.react('❤️'))

  bot.onMessage((ctx) => ctx.reply('Send "vote" or "days" to get a poll.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'poll-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "vote" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`; `:click 2` votes for the second
option of the last poll:

```text
user › vote
bot › [poll] What should we eat tonight?
        [1] 🍕 Pizza
        [2] 🍣 Sushi
        [3] 🥗 Salad
      (:click <n> to vote)
user › :click 2
• voted for "🍣 Sushi"
bot › 🗳️ You picked 🍣 Sushi
      📊 🍕 Pizza: 0 · 🍣 Sushi: 1 · 🥗 Salad: 0
user › days
bot › [poll · multiple choice] Which days can you come?
        [1] Monday
        [2] Wednesday
        [3] Friday
      (:click <n> to vote)
user › :click 3
• voted for "Friday"
bot › 🗳️ You picked Friday
      📊 Monday: 0 · Wednesday: 0 · Friday: 1
user › thanks
bot › [reaction: ❤️]
```

## How it works

- **`ctx.poll(question, options, multiSelect?)`** sends a native poll.
  Polls are native on WhatsApp via Baileys and on Telegram; the WhatsApp
  Cloud API has none (`ctx.poll()` rejects with `UnsupportedContentError`
  there, use buttons, see the [Menu bot](./menu-bot)).
- **Votes are events, not messages.** `bot.on('poll')` receives
  `{ ref, senderId, options }`, where `options` holds every option with its
  `votes` and `voters`. Changing or withdrawing a vote fires it again.
- **`bot.send(chatId, text)`** sends outside a handler; `vote.ref.chatId` is
  the chat where the poll was voted.
- **`ctx.react(emoji)`** reacts to the incoming message. Channels without
  reactions resolve `{ skipped: true }` instead of failing.
- On WhatsApp the votes are end-to-end encrypted: the provider decrypts
  them, but only for polls this process sent or saw (see
  [Poll votes](/guide/messages#poll-votes)).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. On
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); its polls
are sent non-anonymous so the votes reach the bot.

## Next steps

- [Media replies](./media): images, documents, locations and contacts
- [Menu bot](./menu-bot): buttons on channels without polls
- [Messages & media](/guide/messages): every send method
