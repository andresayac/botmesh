# Plugin: Rate Limiter

Build a reusable plugin that limits how many messages each user can send
per time window, and plug it into a bot.

**Level:** Intermediate · **Tags:** WhatsApp, Telegram, Plugins, Hooks

**Features shown:** [`definePlugin()`](/guide/plugins#create-a-plugin) ·
[`before('message')` hooks](/guide/hooks) ·
[`ctx.abort()`](/guide/hooks) ·
[`ctx.onDispose()` and unplug](/guide/plugins#configurable-plugin-with-cleanup) ·
[plugin config](/guide/plugins#configurable-plugin-with-cleanup)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements)). Then install:

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, definePlugin, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const rateLimitPlugin = definePlugin({
  name: 'rate-limit',
  version: '1.0.0',
  description: 'At most N messages per user per window',
  install(ctx, config = {}) {
    const max = config.max ?? 10
    const windowMs = config.windowMs ?? 60_000
    const counts = new Map() // sender → { count, resetAt }

    // Runs before routing: abort() drops the message, next() lets it through
    ctx.bot.before('message', async (msg, next) => {
      const now = Date.now()
      let entry = counts.get(msg.sender)
      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + windowMs }
        counts.set(msg.sender, entry)
      }
      entry.count++
      if (entry.count === max + 1) await msg.reply(`⏳ Slow down: at most ${max} messages every ${windowMs / 1000}s.`)
      if (entry.count > max) return msg.abort()
      await next()
    })

    // Hooks are removed on unplug; anything else is cleaned up here
    const sweep = setInterval(() => {
      const now = Date.now()
      for (const [sender, entry] of counts) if (entry.resetAt < now) counts.delete(sender)
    }, windowMs)
    ctx.onDispose(() => clearInterval(sweep))
  },
})

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // plug() returns unplug(): it removes the hook and runs onDispose()
  bot.plug(rateLimitPlugin, { max: 3, windowMs: 60_000 })

  bot.onMessage((ctx) => ctx.reply(`✅ Got "${ctx.body}"`))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'rate-limit-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send a few messages in a row.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`; the fifth message is dropped
silently, so the user is warned only once per window:

```text
user › one
bot › ✅ Got "one"
user › two
bot › ✅ Got "two"
user › three
bot › ✅ Got "three"
user › four
bot › ⏳ Slow down: at most 3 messages every 60s.
user › five
```

## How it works

- **`definePlugin({ name, install })`** packages the feature; `install` gets
  the plugin context and the config passed to `bot.plug(plugin, config)`. It
  must be synchronous.
- **`ctx.bot.before('message', (msg, next) => ...)`** runs before routing.
  Call `next()` to continue; `msg.abort()` stops the message, so no handler,
  flow or catch-all sees it.
- **Per sender.** `msg.sender` is the user's stable id, so in a group each
  participant has their own counter.
- **Cleanup.** Hooks and handlers registered through `ctx.bot` are undone by
  the function `bot.plug()` returns; timers and outside resources go in
  `ctx.onDispose()`.
- **Outbound too.** A `before('send')` hook sees every message the bot sends
  (`{ chatId, content }`) and can `abort()` it in the same way. For WhatsApp
  anti-ban pacing, `@botmesh/baileys` already rate-limits sends (see
  [Rate limiting](/guide/rate-limiting)).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
plugin works the same on every channel.

## Next steps

- [Plugins](/guide/plugins): `requires`, `multiple` and plugin packages
- [Hooks](/guide/hooks): every hook point and its payload
- [Handoff & access lists](/guide/handoff): block or allow senders without code
