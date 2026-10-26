# Build a plugin: FAQ with tools

Build a reusable FAQ plugin that answers keywords, shares its hit counters
with the rest of the bot as a tool, and cleans up after itself when you
unplug it.

**Level:** Advanced · **Tags:** Plugins, Dependency injection, WhatsApp, Telegram

**Features shown:**
[Plugins](/guide/plugins) (`definePlugin`, `install`/`uninstall`, `ctx.onDispose`, unplug) ·
[Dependency injection](/guide/di) (`provide`, `ctx.tools`) ·
[Slash commands](/guide/plugins#built-in-slashcommands) ·
[Commands and triggers](/guide/concepts) ·
[Terminal simulator](/guide/dev-simulator)

## Prerequisites

Node.js 22.12 or newer and an ESM project (`"type": "module"`), as in
[Getting started](/guide/getting-started#requirements). While botmesh is in
prerelease, read the note there about which npm tag to install.

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, definePlugin, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// 1. The plugin: answers frequent questions and counts which ones people ask
export const faqPlugin = definePlugin({
  name: 'faq',
  version: '1.0.0',
  description: 'Keyword FAQ with hit counters',
  install(ctx, config = {}) {
    const answers = config.answers ?? {}
    const hits = new Map(Object.keys(answers).map((topic) => [topic, 0]))

    // 2. A tool: any handler or plugin reads it as ctx.tools.faq
    ctx.bot.provide('faq', {
      topics: () => [...hits.keys()],
      stats: () => Object.fromEntries(hits),
    })

    // 3. Handlers registered through ctx.bot are removed automatically on unplug
    ctx.bot.command('faq', (c) => c.reply(`❓ Ask me about: ${[...hits.keys()].join(', ')}`))
    for (const [topic, answer] of Object.entries(answers)) {
      ctx.bot.when(topic, async (c) => {
        hits.set(topic, hits.get(topic) + 1)
        await c.reply(answer)
      })
    }

    // 4. Anything else is yours to undo: a timer and the provided tool
    const report = setInterval(() => ctx.logger.info({ hits: Object.fromEntries(hits) }, 'faq stats'), config.reportEvery ?? 3_600_000)
    report.unref()
    ctx.onDispose(() => clearInterval(report))
    ctx.onDispose(() => delete ctx.tools.faq)
  },
  // 5. Runs first when the plugin is unplugged
  uninstall(ctx) {
    ctx.logger.info('faq plugin removed')
  },
})

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })
  bot.plug(slashCommandsPlugin)

  // 6. Use the plugin: plug() returns the function that unplugs it
  const unplugFaq = bot.plug(faqPlugin, {
    answers: {
      hours: '🕘 We are open Monday to Saturday, 9:00 to 18:00.',
      shipping: '🚚 Orders arrive in 2 to 3 business days.',
      returns: '↩️ You can return any item within 30 days.',
    },
  })

  // 7. Read the plugin's tool from your own handlers
  bot.command('faqstats', (ctx) => {
    const faq = ctx.tools.faq
    if (!faq) return ctx.reply('The FAQ is off.')
    const lines = Object.entries(faq.stats()).map(([topic, n]) => `• ${topic}: ${n}`)
    return ctx.reply(`📊 FAQ hits\n${lines.join('\n')}`)
  })
  // An admin switch (protect admin commands in a real bot)
  bot.command('faqoff', (ctx) => {
    unplugFaq()
    return ctx.reply('🔌 FAQ plugin unplugged.')
  })

  bot.onMessage((ctx) => ctx.reply('Send /faq to see what I can answer.'))
  return bot
})

export default createBot

if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-bot' }))
  bot.on('ready', () => bot.logger.info('connected'))
  await bot.start()
}
```

## How it works

### 1. `definePlugin` and `install`

`definePlugin(spec)` only types the spec: a `name`, a `version` and an
`install(ctx, config)` that registers everything. `install` must be
**synchronous** (the bot does not await it). `config` is the second argument
of `bot.plug()`, so one plugin serves several bots with different answers.

### 2. Sharing a tool with `provide`

`ctx.bot.provide('faq', value)` puts `value` in the bot's tool registry. Every
handler, hook and plugin reads it as `ctx.tools.faq`: the bot's own
`/faqstats` command (step 7) uses the plugin's counters without importing
anything from it. See [Dependency injection](/guide/di).

### 3. What unplug undoes for you

Handlers registered **through `ctx.bot`** (`command`, `when`, `onMessage`,
hooks, flows, nested plugins) are tracked and removed when the plugin is
unplugged. That is why `hours` stops answering after `/faqoff`.

### 4. What you undo yourself: `ctx.onDispose`

Unplug does not know about your timers, connections or the tools you
`provide()`d. Register their cleanup with `ctx.onDispose(fn)`. Here it stops
the hourly stats log and deletes `ctx.tools.faq`, so `/faqstats` can tell the
plugin is gone. `report.unref()` keeps the timer from holding the process open.

### 5. `uninstall`

`uninstall(ctx)` runs first on unplug, before the automatic rollback and the
`onDispose` callbacks: the place to flush or log a final state.

### 6. Plugging and unplugging

`bot.plug(plugin, config)` returns the unplug function (not the bot, so plug
calls do not chain). Calling it twice is a no-op. Plugging a second plugin
named `faq` throws unless the spec sets `multiple: true`.

## Sample transcript

Captured with `npx botmesh dev bot.js`:

```text
user › /faq
bot › ❓ Ask me about: hours, shipping, returns
user › hours
bot › 🕘 We are open Monday to Saturday, 9:00 to 18:00.
user › Shipping
bot › 🚚 Orders arrive in 2 to 3 business days.
user › hours
bot › 🕘 We are open Monday to Saturday, 9:00 to 18:00.
user › /faqstats
bot › 📊 FAQ hits
      • hours: 2
      • shipping: 1
      • returns: 0
user › /faqoff
bot › 🔌 FAQ plugin unplugged.
user › hours
bot › Send /faq to see what I can answer.
user › /faqstats
bot › The FAQ is off.
```

`Shipping` matches `shipping`: text triggers compare the whole message,
normalized (case, accents and extra spaces).

## Run it on WhatsApp or Telegram

`node bot.js` connects to WhatsApp: scan the QR with the phone that will be
the bot. For Telegram, install `@botmesh/telegram` and pass
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` instead; the
plugin does not change. See [Channels](/guide/channels).

## Next steps

- [Plugins](/guide/plugins): `requires`, `multiple` and the full `ctx` reference
- [Testing your bot](./testing-your-bot): cover the plugin with `createTestBot`
- [Example: rate limiter](./rate-limiter): a plugin built on a `before('message')` hook
