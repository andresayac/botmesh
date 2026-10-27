# Menu Bot

Build a pizza-place bot driven by numbered menus that work on every
channel, plus native buttons where the channel has them.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Flows, Buttons

**Features shown:** [`flow().choose()` numbered menus](/guide/flows#dsl-methods) ·
[`then` sub-flows](/guide/flows#dsl-methods) ·
[`c.state`](/guide/flows#typed-state) ·
[`bot.conversation()`](/guide/flows#beyond-the-dsl) ·
[buttons per transport](/guide/messages#buttons-normalized-degraded-per-transport) ·
[capability matrix](/guide/channels#capability-matrix)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements)). Then install:

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const PRICES = { small: 8, medium: 10, large: 12 }

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // A sub-flow with no trigger of its own: the main menu runs it
  const order = flow([])
    .choose('Which size?', { small: 'Small ($8)', medium: 'Medium ($10)', large: 'Large ($12)' }, 'size')
    .choose('Which flavour?', { margherita: 'Margherita', pepperoni: 'Pepperoni', veggie: 'Veggie' }, 'flavour')
    .say((_ctx, c) => `✅ One ${c.state.size} ${c.state.flavour}: $${PRICES[c.state.size]}. Ready in 20 minutes!`)

  // Numbered menu: works everywhere, WhatsApp via Baileys included
  bot.use(
    flow('menu').choose('🍕 *Pizza Place*: what would you like?', {
      order: { label: 'Order a pizza', then: order },
      hours: { label: 'Opening hours', then: (_ctx, c) => c.say('🕘 Every day, 12:00 to 23:00.') },
    }),
  )

  // Native buttons where the channel renders them (Telegram, WhatsApp Cloud API),
  // the same question as a numbered menu everywhere else
  bot.conversation('rate', async (c, ctx) => {
    const options = { great: '😋 Great', ok: '🙂 OK', meh: '😕 Meh' }
    let answer
    if (ctx.capabilities?.buttons) {
      await ctx.buttons('How was your pizza?', Object.entries(options).map(([id, title]) => ({ id, title })))
      answer = (await c.waitAny()).body // a tap arrives as a message whose text is the button id
    } else {
      answer = await c.choose('How was your pizza?', options)
    }
    await ctx.reply(Object.hasOwn(options, answer) ? `Thanks for rating us ${options[answer]}!` : 'Thanks for your feedback!')
  })

  bot.onMessage((ctx) => ctx.reply('Send "menu" to order or "rate" to rate us.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'menu-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "menu" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`. The simulator renders native
buttons, so `rate` shows them; `:click 1` taps the first one:

```text
user › menu
bot › 🍕 *Pizza Place*: what would you like?

      1) Order a pizza
      2) Opening hours
user › 1
bot › Which size?

      1) Small ($8)
      2) Medium ($10)
      3) Large ($12)
user › 7
bot › Which size?

      1) Small ($8)
      2) Medium ($10)
      3) Large ($12)
user › 2
bot › Which flavour?

      1) Margherita
      2) Pepperoni
      3) Veggie
user › pepperoni
bot › ✅ One medium pepperoni: $10. Ready in 20 minutes!
user › menu
bot › 🍕 *Pizza Place*: what would you like?

      1) Order a pizza
      2) Opening hours
user › 2
bot › 🕘 Every day, 12:00 to 23:00.
user › rate
bot › How was your pizza?
        [1] 😋 Great
        [2] 🙂 OK
        [3] 😕 Meh
      (:click <n> to choose)
user › :click 1
• tapped "😋 Great"
bot › Thanks for rating us 😋 Great!
```

## How it works

- **`.choose(prompt, options, key)`** sends a numbered menu and waits. The
  user answers with the number, the key or the label ("pepperoni"); anything
  else re-sends the menu. The chosen **key** lands in `c.state[key]`.
- **`then`** runs when that option is picked: a whole flow (`order`, which
  runs inline and comes back) or a function such as
  `(_ctx, c) => c.say(...)`. `flow([])` has no trigger, so it only runs from
  the menu.
- **Buttons.** WhatsApp Web dropped native buttons, so on Baileys
  `ctx.buttons()` would arrive as a numbered list the user answers with a
  number. `ctx.capabilities?.buttons` tells whether the channel renders them;
  a tap arrives as a `buttons` message whose text is the button `id`, so
  `c.waitAny()` takes it (`c.waitText()` only accepts typed text, and the
  user could still type instead of tapping). Elsewhere `c.choose()` asks the
  same question as a numbered menu.
- **Escape hatch.** Add [`slashCommandsPlugin`](/guide/plugins#built-in-slashcommands)
  and `/cancel` leaves any menu: commands always win over an active
  conversation.

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices (menus are
numbered). On Telegram, install `@botmesh/telegram` and swap the provider as
shown in [Or connect Telegram](/guide/getting-started#or-connect-telegram):
`rate` then shows an inline keyboard.

## Next steps

- [Shopping flow](./shopping-flow): branching with `goto` and a "back to menu" option
- [Poll bot](./poll-bot): native polls on WhatsApp and Telegram
- [Conversation flows](/guide/flows): the whole flow DSL
