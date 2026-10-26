# Testing your bot: Vitest and golden transcripts

Cover a bot with real tests: drive conversations with `createTestBot`, assert
every reply, and lock the whole exchange down as a golden transcript that a
later change cannot break silently.

**Level:** Advanced · **Tags:** Testing, Vitest, Golden transcripts, Flows

**Features shown:**
[Testing](/guide/testing) (`createTestBot`, `MockProvider`, `expectReply`, `expectNoReply`) ·
[Golden transcripts](/guide/golden-transcripts) (`redactTranscript`, `serializeTranscript`, `assertTranscript`) ·
[Flows](/guide/flows) (`.ask` with `validate`, `.timeout`) ·
[Slash commands](/guide/plugins#built-in-slashcommands) ·
[Terminal simulator](/guide/dev-simulator) (`defineBot`)

## Prerequisites

Node.js 22.12 or newer and an ESM project (`"type": "module"`), as in
[Getting started](/guide/getting-started#requirements). While botmesh is in
prerelease, read the note there about which npm tag to install.

```bash
npm install @botmesh/core @botmesh/baileys
npm install -D vitest
```

The project:

```text
pizza-bot/
├── bot.js
├── package.json            "type": "module", "scripts": { "test": "vitest run" }
└── tests/
    ├── bot.test.js
    └── golden/order.json   written by the first test run, then committed
```

## The bot under test

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const PRICES = { margherita: 9, pepperoni: 11 }

// 1. Everything the bot does, registered on any Bot: the app and the tests share it
export function setupBot(bot) {
  bot.plug(slashCommandsPlugin)
  bot.when(['hi', 'hello'], (ctx) => ctx.reply('🍕 Welcome to Pizza Bot! Send "order" to start.'))
  bot.use(
    flow('order')
      .ask('Which pizza? margherita ($9) or pepperoni ($11)', 'pizza', {
        validate: (body) => (Object.hasOwn(PRICES, body.trim().toLowerCase()) ? true : '❌ We have margherita and pepperoni.'),
      })
      .ask('How many? (1-9)', 'qty', {
        validate: (body) => (/^[1-9]$/.test(body.trim()) ? true : '❌ Send a number from 1 to 9.'),
      })
      .say((_ctx, c) => {
        const pizza = c.state.pizza.trim().toLowerCase()
        const qty = Number(c.state.qty)
        return `✅ ${qty} × ${pizza}: $${qty * PRICES[pizza]}. Thanks!`
      })
      .timeout('10m'),
  )
  bot.onMessage((ctx) => ctx.reply('Send "order" to buy a pizza.'))
  return bot
}

// 2. The factory for `npx botmesh dev`, `node bot.js` and transcript replays
const createBot = defineBot((provider) => setupBot(new Bot({ provider })))
export default createBot

if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'pizza-bot' }))
  await bot.start()
}
```

## The complete test file

```js
// tests/bot.test.js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { assertTranscript, createTestBot, parseTranscript, redactTranscript, serializeTranscript } from '@botmesh/core/testing'
import createBot, { setupBot } from '../bot.js'

const GOLDEN = new URL('./golden/order.json', import.meta.url)

// 1. A fresh bot per test, on a MockProvider: no phone, no network
let running
async function startBot() {
  const t = await createTestBot()
  setupBot(t.bot)
  running = t.bot
  return t
}
afterEach(async () => {
  await running?.stop()
})

test('greets and points to the order flow', async () => {
  const { chat } = await startBot()
  await chat.send('hello')
  await chat.expectReply('🍕 Welcome to Pizza Bot! Send "order" to start.')
  await chat.send('what?')
  await chat.expectReply('Send "order" to buy a pizza.')
})

// 2. Drive a whole conversation, including a validation error
test('orders two pepperoni', async () => {
  const { chat } = await startBot()
  await chat.send('order')
  await chat.expectReply('Which pizza? margherita ($9) or pepperoni ($11)')
  await chat.send('Pepperoni')
  await chat.expectReply('How many? (1-9)')
  await chat.send('lots')
  await chat.expectReply('❌ Send a number from 1 to 9.')
  await chat.send('2')
  await chat.expectReply('✅ 2 × pepperoni: $22. Thanks!')
  await chat.expectNoReply()

  // 3. Save it as the golden transcript the first time (or with UPDATE_GOLDEN=1)
  if (!existsSync(GOLDEN) || process.env.UPDATE_GOLDEN) {
    mkdirSync(new URL('./golden/', import.meta.url), { recursive: true })
    writeFileSync(GOLDEN, serializeTranscript(redactTranscript(chat.transcript({ name: 'order' }))))
  }
})

// 4. Commands always win over an active conversation
test('/cancel leaves the flow', async () => {
  const { chat } = await startBot()
  await chat.send('order')
  await chat.expectReply('Which pizza?')
  await chat.send('/cancel')
  await chat.expectReply(/cancelled/)
  await chat.send('2')
  await chat.expectReply('Send "order" to buy a pizza.')
  expect(chat.replies()).toHaveLength(3)
})

// 5. Replay the golden transcript against the real factory: any changed reply fails with a diff
test('the order conversation matches its golden transcript', async () => {
  const golden = parseTranscript(readFileSync(GOLDEN, 'utf8'))
  await assertTranscript(golden, createBot)
})
```

Run it:

```bash
npx vitest run
```

The first run passes and writes `tests/golden/order.json`. Commit that file:
from then on the last test replays it against `createBot` on every run.

## How it works

### 1. One setup function, two entry points

`setupBot(bot)` registers everything on whatever `Bot` it receives. The
factory (`createBot`) wraps it for `npx botmesh dev` and `node bot.js`, and
the tests call it on the bot that `createTestBot()` builds. The tests and
the real bot never drift apart.

### 2. Conversations with `createTestBot`

`createTestBot()` starts a `Bot` on a `MockProvider`: no phone, no network.
`chat.send()` is a user message; `chat.expectReply()` waits for a reply
that contains the text (or matches a RegExp) and fails with a readable
`TestKitError` listing what the bot did send. `chat.expectNoReply()` proves
the bot stays quiet. Stop each bot in `afterEach` so no timer outlives the test.

### 3. Recording the golden transcript

`chat.transcript()` returns the exchange in the golden-transcript format.
`redactTranscript()` replaces ids and display names with placeholders
(`<user:1>`, `<name:1>`), and phone numbers or emails the user typed, so the
file is safe to commit. `serializeTranscript()` writes stable,
diff-friendly JSON. Set `UPDATE_GOLDEN=1` to record it again after an
intended change.

### 4. Commands win

`/cancel` comes from `slashCommandsPlugin`. Commands always beat an active
conversation, so the user can always leave a flow; the test proves the
flow is really gone because `2` reaches the catch-all.

### 5. Replaying it

`assertTranscript(golden, createBot)` builds a fresh bot with the factory,
replays every inbound turn and compares each reply. A changed, missing or
extra reply throws a `TranscriptMismatchError` with an expected-vs-actual
report. For replies that change on every run (dates, ids), pass masks:
`assertTranscript(golden, createBot, { masks: [REPLAY_MASKS.isoDate] })`.

### The golden file

The start of `tests/golden/order.json` after the first run:

```json
{
  "format": "botmesh/transcript",
  "version": 1,
  "source": "recorder",
  "name": "order",
  "turns": [
    {
      "dir": "in",
      "chatId": "<user:1>",
      "senderId": "<user:1>",
      "type": "text",
      "text": "order",
      "displayName": "<name:1>"
    },
    {
      "dir": "out",
      "chatId": "<user:1>",
      "kind": "text",
      "text": "Which pizza? margherita ($9) or pepperoni ($11)",
      "content": {
        "kind": "text",
        "text": "Which pizza? margherita ($9) or pepperoni ($11)"
      }
    }
  ],
  "redacted": true
}
```

## Sample transcript

The same bot by hand, captured with `npx botmesh dev bot.js`:

```text
user › hi
bot › 🍕 Welcome to Pizza Bot! Send "order" to start.
user › order
bot › Which pizza? margherita ($9) or pepperoni ($11)
user › hawaiian
bot › ❌ We have margherita and pepperoni.
user › Pepperoni
bot › How many? (1-9)
user › lots
bot › ❌ Send a number from 1 to 9.
user › 2
bot › ✅ 2 × pepperoni: $22. Thanks!
user › /ping
bot › pong 🏓
```

## Run it on WhatsApp or Telegram

`node bot.js` connects to WhatsApp: scan the QR with the phone that will be
the bot. For Telegram, install `@botmesh/telegram` and pass
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` to `createBot`.
The tests do not change: they never touch a real channel.

## Next steps

- [Testing](/guide/testing): several users and groups, Vitest matchers and the chaos kit
- [Golden transcripts](/guide/golden-transcripts): recording from production, redaction rules and replay options
- [Build a plugin](./faq-plugin): a plugin you can cover with the same tools
