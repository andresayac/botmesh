# Group bot

Build a bot for group chats: a quiz each member plays on their own, a shared
scoreboard, rules only admins can change, and a hello when someone mentions
the bot.

**Level:** Intermediate · **Tags:** WhatsApp, Telegram, Groups

**Features shown:**
[per-participant conversations](/guide/concepts#group-conversations-are-per-participant) ·
[`scope('group')`](/guide/flows#dsl-methods) ·
[mentions (`ctx.mentions`)](/guide/messages#the-full-messagecontext) ·
[`groupMode`](/guide/configuration#routing-and-conversations) ·
[commands with arguments](/guide/concepts#when-simple-responses) ·
[predicate and `contains` triggers](/guide/concepts#when-simple-responses)

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
import { Bot, defineBot, flow, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Bot admins: their user ids, as /id shows them (WhatsApp: 573001234567@s.whatsapp.net)
const ADMINS = (process.env.ADMINS ?? 'ana').split(',')

const createBot = defineBot((provider) => {
  // 1. Defaults that matter in groups: every group message is routed (groupMode: 'all')
  //    and each participant gets their own conversation (conversationScope: 'participant')
  const bot = new Bot({ provider })
  const rules = new Map() // group id → rules text
  const scores = new Map() // group id → Map(name → points)
  const isAdmin = (ctx) => ADMINS.includes(ctx.sender)
  const nameOf = (ctx) => ctx.pushName ?? ctx.sender

  // 2. A quiz per participant: two people can play at the same time
  bot.use(
    flow({ pattern: 'quiz', match: 'contains' })
      .scope('group')
      .ask((ctx) => `🧠 ${nameOf(ctx)}, 2 + 2 = ?`, 'q1')
      .ask((ctx) => `🌍 ${nameOf(ctx)}, capital of France?`, 'q2')
      .say((ctx, c) => {
        const points = (c.state.q1.trim() === '4' ? 1 : 0) + (c.state.q2.trim().toLowerCase() === 'paris' ? 1 : 0)
        const board = scores.get(ctx.from) ?? new Map()
        board.set(nameOf(ctx), (board.get(nameOf(ctx)) ?? 0) + points)
        scores.set(ctx.from, board)
        return `🏁 ${nameOf(ctx)}: ${points}/2`
      }),
  )

  // 3. Commands anyone can use
  bot.command('rules', (ctx) => ctx.reply(rules.get(ctx.from) ?? 'No rules yet.'))
  bot.command('scores', (ctx) => {
    const board = [...(scores.get(ctx.from) ?? [])].sort((a, b) => b[1] - a[1])
    return ctx.reply(board.length ? board.map(([name, points]) => `${name}: ${points}`).join('\n') : 'No scores yet. Send "quiz".')
  })

  // 4. Admin-only commands
  bot.command('setrules', async (ctx, args) => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ Only admins can change the rules.')
    rules.set(ctx.from, `📜 ${args.join(' ')}`)
    await ctx.reply('✅ Rules updated.')
  })
  bot.command('resetscores', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ Only admins can reset the scores.')
    scores.delete(ctx.from)
    await ctx.reply('🧹 Scores cleared.')
  })

  // 5. In a DM, explain; in a group, answer only when someone mentions the bot
  bot.onMessage((ctx) => {
    if (!ctx.isGroup) return ctx.reply('Add me to a group and send "quiz" there.')
    if (provider.selfId != null && ctx.mentions.includes(provider.selfId)) {
      return ctx.reply(`👋 Hi ${nameOf(ctx)}! Send "quiz" to play, /scores or /rules.`)
    }
  })

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'group-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

1. **Group defaults.** Every group message reaches the bot, and in a group
   each participant has their own conversation. `ctx.from` is the group
   (the chat), `ctx.sender` the person who wrote.
2. **One quiz per person.** Ana and Bob can be halfway through the quiz at
   the same time: each answer goes to its sender's conversation.
   `.scope('group')` keeps the quiz out of DMs. `{ pattern: 'quiz', match: 'contains' }`
   also starts it from `@bot quiz`, and the flow's id (`quiz`) comes from that
   pattern. Scores are kept per group in a `Map`.
3. **Commands for everyone.** `/rules` and `/scores` answer with the data of
   the group they are sent in.
4. **Admin-only commands.** The bot checks `ctx.sender` against `ADMINS`. These
   are the bot's admins, not the group's: botmesh does not read a group's
   admin list, so keep yours in configuration (send `/id` to learn an id).
5. **Mentions.** `ctx.mentions` lists the users a message mentions, and
   `provider.selfId` is the bot's own id once connected. The catch-all checks
   them, and it only sees what no other handler took, so `@bot quiz` still
   starts the quiz.
6. **Quiet in groups.** In a group the catch-all replies only to a mention, so
   the bot does not answer every message of the group; in a DM it explains
   how to use it.

## Try it

```bash
npx botmesh dev bot.js --user ana --name Ana --group team
```

`:as bob Bob` switches to another member of the same group; the bot is
mentioned as `@bot`.

```text
ana @ team › hello everyone
ana @ team › @bot hi
bot › 👋 Hi Ana! Send "quiz" to play, /scores or /rules.
ana @ team › quiz
bot › 🧠 Ana, 2 + 2 = ?
ana @ team › :as bob Bob
• you are now "bob" (Bob) in group "team"
bob @ team › quiz
bot › 🧠 Bob, 2 + 2 = ?
bob @ team › 4
bot › 🌍 Bob, capital of France?
bob @ team › :as ana Ana
• you are now "ana" (Ana) in group "team"
ana @ team › 4
bot › 🌍 Ana, capital of France?
ana @ team › paris
bot › 🏁 Ana: 2/2
ana @ team › :as bob Bob
• you are now "bob" (Bob) in group "team"
bob @ team › rome
bot › 🏁 Bob: 1/2
bob @ team › /scores
bot › Ana: 2
      Bob: 1
bob @ team › /setrules Be kind
bot › ⛔ Only admins can change the rules.
bob @ team › :as ana Ana
• you are now "ana" (Ana) in group "team"
ana @ team › /setrules Be kind. No spam.
bot › ✅ Rules updated.
ana @ team › /rules
bot › 📜 Be kind. No spam.
```

## Variation: only when mentioned

To make the bot ignore every group message that does not mention it, set
`groupMode` (`'commands'` keeps only commands):

```js
const bot = new Bot({ provider, groupMode: 'mentions' })
```

The filter applies to **every** group message, answers to a running
conversation included, so with this mode a player has to mention the bot in
each answer, and the mention is part of the answer text. Commands need a
mention too (`/rules @bot`; on Telegram, `/rules@YourBot` counts as one):

```text
ana @ team › quiz
ana @ team › @bot quiz
bot › 🧠 Ana, 2 + 2 = ?
ana @ team › 4
ana @ team › @bot 4
bot › 🌍 Ana, capital of France?
ana @ team › /rules
ana @ team › /rules @bot
bot › No rules yet.
```

That is why this example keeps the default `groupMode: 'all'` and stays quiet
with a DM-only catch-all instead.

## Run it on WhatsApp or Telegram

Set `ADMINS` to your id (send `/id` to the bot to see it), start the bot with
`node bot.js`, scan the QR from **WhatsApp → Linked devices** and add the
bot's number to a group. On Telegram, install `@botmesh/telegram`, swap the
provider as in [Or connect Telegram](/guide/getting-started#or-connect-telegram)
and add the bot to a group. With BotFather's default privacy mode a Telegram
bot only receives commands, mentions and replies to its own messages in
groups; turn it off (`/setprivacy`) for the quiz answers to arrive.

## Next steps

- [Core concepts](/guide/concepts#group-conversations-are-per-participant): `conversationScope: 'chat'` for one shared conversation per group
- [Human handoff](./human-handoff): pause the bot in one chat
- [WhatsApp and Telegram at once](./whatsapp-and-telegram): what group ids look like on each channel
