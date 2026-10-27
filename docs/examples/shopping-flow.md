# Shopping Flow

Build a small shop: pick a product and a quantity from numbered menus,
confirm, enter the address in a reusable sub-flow, or go back and start over.

**Level:** Intermediate · **Tags:** WhatsApp, Telegram, Flows

**Features shown:** [`.choose()` menus](/guide/flows#dsl-methods) ·
[`then` sub-flows](/guide/flows#dsl-methods) ·
[`goto`](/guide/flows#dsl-methods) ·
[`c.state`](/guide/flows#typed-state) ·
[`.timeout()` and `timeoutMessage`](/guide/flows#dsl-methods) ·
[`bot.lint()`](/guide/flow-tools)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements)). Then install:

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const PRODUCTS = {
  phone: { label: '📱 Phone ($599)', price: 599 },
  shirt: { label: '👕 Shirt ($25)', price: 25 },
  lamp: { label: '🏠 Lamp ($35)', price: 35 },
}

const createBot = defineBot((provider) => {
  const bot = new Bot({
    provider,
    // Sent when a wait of the flow times out
    conversation: { timeoutMessage: '⏰ Your cart expired. Send "shop" to start again.' },
  })
  bot.plug(slashCommandsPlugin)

  // A reusable sub-flow: runs inline from the checkout and comes back
  const address = flow([]).ask('🏠 Street and number?', 'street').ask('🏙️ City?', 'city')

  bot.use(
    flow('shop')
      .timeout('2m')
      .choose('🛒 *What do you want to buy?*', {
        phone: PRODUCTS.phone.label,
        shirt: PRODUCTS.shirt.label,
        lamp: PRODUCTS.lamp.label,
      }, 'product')
      .choose('How many?', { one: '1 unit', two: '2 units', three: '3 units' }, 'qty')
      .say((_ctx, c) => {
        const qty = { one: 1, two: 2, three: 3 }[c.state.qty]
        const product = PRODUCTS[c.state.product]
        c.state.total = qty * product.price
        return `🧾 ${qty} × ${product.label} = $${c.state.total}`
      })
      .choose('Confirm your order?', {
        yes: { label: 'Yes ✅', then: address },
        change: { label: '⬅️ Pick another product', goto: 'shop' },
      })
      .say((_ctx, c) => `📦 Order placed: $${c.state.total}, shipping to ${c.state.street}, ${c.state.city}.`),
  )

  bot.onMessage((ctx) => ctx.reply('Send "shop" to start shopping.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'shop-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "shop" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`:

```text
user › shop
bot › 🛒 *What do you want to buy?*

      1) 📱 Phone ($599)
      2) 👕 Shirt ($25)
      3) 🏠 Lamp ($35)
user › 1
bot › How many?

      1) 1 unit
      2) 2 units
      3) 3 units
user › 2
bot › 🧾 2 × 📱 Phone ($599) = $1198
bot › Confirm your order?

      1) Yes ✅
      2) ⬅️ Pick another product
user › 2
bot › 🛒 *What do you want to buy?*

      1) 📱 Phone ($599)
      2) 👕 Shirt ($25)
      3) 🏠 Lamp ($35)
user › 2
bot › How many?

      1) 1 unit
      2) 2 units
      3) 3 units
user › 3
bot › 🧾 3 × 👕 Shirt ($25) = $75
bot › Confirm your order?

      1) Yes ✅
      2) ⬅️ Pick another product
user › 1
bot › 🏠 Street and number?
user › 742 Evergreen Terrace
bot › 🏙️ City?
user › Springfield
bot › 📦 Order placed: $75, shipping to 742 Evergreen Terrace, Springfield.
```

## How it works

- **`.choose(prompt, options, key)`** sends a numbered menu, accepts the
  number, the key or the label, and stores the chosen **key** in
  `c.state[key]`. Without a key it goes to `c.state.choice`.
- **`then: address`** runs the `address` flow inline when "Yes" is picked;
  it shares `c.state`, so the last `.say()` reads `street` and `city`.
  `flow([])` has no trigger: it only runs from here.
- **`goto: 'shop'`** leaves the current flow and starts the named one
  (here, the same shop from the top). `bot.lint()` reports a `goto` to a
  flow that is not registered as an error (`goto-target-missing`).
- **A function `.say()`** can compute and store values (`c.state.total`)
  for later steps.
- **`.timeout('2m')`** applies to every wait of the flow; when it fires the
  bot sends `conversation.timeoutMessage`. A `then` sub-flow uses its own
  `.timeout()` (or the bot-wide default).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Support with timeout](./support-flow): `bot.conversation()` with full control
- [Menu bot](./menu-bot): native buttons where the channel has them
- [Inspect & lint flows](/guide/flow-tools): check flows before running them
