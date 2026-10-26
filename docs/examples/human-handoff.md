# Human handoff

Build a support bot that passes the chat to a person on request, relays the
user's messages to the agents, lets them answer with commands, and takes the
chat back when they close it or stop answering.

**Level:** Intermediate · **Tags:** WhatsApp, Support, Handoff

**Features shown:**
[human handoff](/guide/handoff#human-handoff) ·
[escape commands (`allowCommands`)](/guide/handoff#what-happens-while-a-chat-is-handed-off) ·
[`'handoff'`, `'resume'` and `'message'` events](/guide/handoff#human-handoff) ·
[commands with arguments](/guide/concepts#when-simple-responses) ·
[sending outside a handler](/guide/messages#sending-outside-a-handler) ·
[`bot.delay()`](/guide/scheduler)

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
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Who answers handed-off chats: their user ids, as /id shows them
const AGENTS = (process.env.AGENTS ?? 'agent').split(',')
// Give the chat back to the bot when no agent writes for this long
const AGENT_TIMEOUT = '10m'

const createBot = defineBot((provider) => {
  // 1. `/bot` keeps working while a person has the chat
  const bot = new Bot({ provider, handoff: { allowCommands: ['/bot'] } })
  const tickets = new Map() // ticket number → chat id
  let lastTicket = 0
  const timers = new Map() // chat id → inactivity timer
  const isAgent = (ctx) => AGENTS.includes(ctx.sender)
  const ticketOf = (chatId) => [...tickets].find(([, id]) => id === chatId)?.[0]

  // Restart the countdown that returns the chat to the bot
  const armTimer = (chatId) => {
    timers.get(chatId)?.cancel()
    timers.set(chatId, bot.delay(AGENT_TIMEOUT, async () => { await bot.resume(chatId, { reason: 'timeout' }) }))
  }

  bot.plug(slashCommandsPlugin, {
    greeting: '👋 I am the support bot. Ask me for "hours", or send "human" to talk to a person.',
  })

  bot.when('hours', (ctx) => ctx.reply('🕘 We are open Monday to Friday, 9:00 to 18:00.'))

  // 2. The user asks for a person: hand the chat off
  bot.when(['human', 'agent', 'talk to a human'], async (ctx) => {
    await ctx.reply('🙋 Connecting you with a person. Send /bot to come back to me.')
    await ctx.handoff({ reason: 'user request' })
  })

  // 3. Tell the agents, and start the countdown
  bot.on('handoff', async ({ chatId }) => {
    const ticket = ++lastTicket
    tickets.set(ticket, chatId)
    armTimer(chatId)
    for (const agent of AGENTS) {
      await bot.send(agent, `🔔 Ticket #${ticket} needs a person. Answer with /reply ${ticket} <text>, close it with /done ${ticket}.`)
    }
  })

  // 4. While handed off the bot stays quiet, but every message still fires 'message'
  bot.on('message', async (ctx) => {
    const ticket = ticketOf(ctx.from)
    if (!bot.isHandedOff(ctx.from) || ticket === undefined) return
    for (const agent of AGENTS) await bot.send(agent, `💬 #${ticket}: ${ctx.body}`)
  })

  // 5. Agent commands (only from the agents' ids)
  bot.command('reply', async (ctx, [ticket, ...words]) => {
    if (!isAgent(ctx)) return
    const chatId = tickets.get(Number(ticket))
    if (!chatId || !bot.isHandedOff(chatId)) return ctx.reply(`Ticket #${ticket} is not open.`)
    armTimer(chatId)
    await bot.send(chatId, `👩‍💼 ${words.join(' ')}`)
  })
  bot.command('done', async (ctx, [ticket]) => {
    if (!isAgent(ctx)) return
    const chatId = tickets.get(Number(ticket))
    if (chatId && (await bot.resume(chatId, { reason: 'agent' }))) await ctx.reply(`✅ Ticket #${ticket} closed.`)
  })

  // 6. The user calls the bot back
  bot.command('bot', (ctx) => bot.resume(ctx.from, { reason: 'user' }))

  // 7. Back to the bot, however it happened
  bot.on('resume', async ({ chatId, reason }) => {
    timers.get(chatId)?.cancel()
    timers.delete(chatId)
    for (const [ticket, id] of tickets) if (id === chatId) tickets.delete(ticket)
    await bot.send(
      chatId,
      reason === 'timeout'
        ? '⏰ No one is free right now, so I am back. Try "human" again later.'
        : '🤖 I am back. Ask me for "hours" or send "human".',
    )
  })

  bot.onMessage((ctx) => ctx.reply('Ask me for "hours", or send "human" to talk to a person.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'support-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

1. **The gate.** While a chat is handed off the bot does not route its
   messages: no handlers, flows or catch-all. Only the commands listed in
   `handoff.allowCommands` that have a `bot.command()` still run, so `/bot`
   always brings the bot back.
2. **Starting a handoff.** `ctx.handoff()` closes the gate for this chat and
   cancels any conversation in it. The handler that hands off can still reply.
3. **Telling the agents.** The `'handoff'` event fires once per handoff.
   `bot.send(chatId, text)` sends outside a handler, here to each agent's own
   chat. The ticket number keeps the agent commands short.
4. **Relaying.** Messages of a handed-off chat are still stored and still fire
   the `'message'` event, which forwards them to the agents. (Your CRM or
   inbox would subscribe here.)
5. **Agent commands.** `bot.command('reply', (ctx, args) => ...)` receives the
   words after the command. `isAgent(ctx)` checks the sender id, so anyone
   else typing `/reply` gets nothing.
6. **Back to the bot.** `bot.resume(chatId, { reason })` reopens the gate and
   fires `'resume'` with that reason, whoever called it: the agent (`/done`),
   the user (`/bot`) or the timer.
7. **The timeout.** `bot.delay(AGENT_TIMEOUT, fn)` runs once after
   10 minutes; every agent reply restarts it. If no agent writes in time, the
   chat goes back to the bot with the `timeout` message. The `'resume'`
   handler cancels the timer however the handoff ended.

The handoff state is saved in the store, so with a persistent store
([SQLite, Redis](/guide/store)) a chat stays with the agents after a restart.
This example keeps tickets and timers in memory: rebuild them from
`bot.listHandoffs()` on start if you need them to survive.

## Try it

```bash
npx botmesh dev bot.js --user ana
```

The agent is the user `agent`: `:as agent` switches to them, and the lines
`bot → agent ›` are what the bot sends to the agent's chat.

```text
ana › hours
bot › 🕘 We are open Monday to Friday, 9:00 to 18:00.
ana › human
bot › 🙋 Connecting you with a person. Send /bot to come back to me.
bot → agent › 🔔 Ticket #1 needs a person. Answer with /reply 1 <text>, close it with /done 1.
bot → agent › 💬 #1: human
ana › my invoice is wrong
bot → agent › 💬 #1: my invoice is wrong
ana › :as agent
• you are now "agent" (agent)
agent › /reply 1 Hi, I am Laura. Let me check your invoice.
bot → ana › 👩‍💼 Hi, I am Laura. Let me check your invoice.
agent › /done 1
bot → ana › 🤖 I am back. Ask me for "hours" or send "human".
bot › ✅ Ticket #1 closed.
agent › :as ana
• you are now "ana" (ana)
ana › human
bot › 🙋 Connecting you with a person. Send /bot to come back to me.
bot → agent › 🔔 Ticket #2 needs a person. Answer with /reply 2 <text>, close it with /done 2.
bot → agent › 💬 #2: human
ana › /bot
bot › 🤖 I am back. Ask me for "hours" or send "human".
ana › hours
bot › 🕘 We are open Monday to Friday, 9:00 to 18:00.
```

## Run it on WhatsApp or Telegram

Set `AGENTS` to the agents' ids (send `/id` from each agent's phone to learn
them), then `node bot.js` and scan the QR from **WhatsApp → Linked devices**:

```bash
AGENTS=573001234567@s.whatsapp.net node bot.js
```

On Telegram the ids are numbers (`AGENTS=123456789`); install
`@botmesh/telegram` and swap the provider as in
[Or connect Telegram](/guide/getting-started#or-connect-telegram).

## Next steps

- [Human handoff & access lists](/guide/handoff): persistence, events and blacklists
- [Group bot](./group-bot): commands only some users may run
- [Integrations](/guide/integrations): hand off to a real inbox such as Chatwoot
