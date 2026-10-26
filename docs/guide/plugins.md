# Plugins

Plugins are reusable packages of functionality.

## Use a plugin

```ts
import { Bot, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }) })

const unplug = bot.plug(slashCommandsPlugin, {
  greeting: '🤖 Hi! Send /help to see my commands.',
})

await bot.start()

// later, if you need to revert everything the plugin registered:
// unplug()
```

`bot.plug(plugin, config?)` returns an **unplug** function (not the bot, so
`plug()` calls do not chain). Calling it first runs the plugin's
`uninstall(ctx)`, if it has one, and then reverts, newest first, what the
plugin registered through `ctx.bot`:

- commands (`command()`), matchers (`when()`, `onMessage()`, `onType()`),
  conversations and flow triggers (`conversation()`, `use(flow)`);
- hooks (`before()`, `after()`, `onError()`, `hook()`);
- nested plugins (`ctx.bot.plug()`);
- flows registered at runtime with `ctx.bot.registerFlow()`, or created (not
  replaced) with `ctx.bot.replaceFlow()`;
- every `ctx.onDispose(fn)` callback.

It does **not** undo anything else: event listeners (`ctx.bot.on()` /
`once()`), injected tools (`ctx.bot.provide()` / `ctx.tools`), locale messages
(`ctx.bot.locale()`), scheduled jobs (`schedule()`, `every()`, `delay()`),
idle handlers (`onIdle()`), a flow that `replaceFlow()` overwrote (it is not
restored), handoff state, store writes, or timers and connections of your own.
Undo those in `ctx.onDispose()` (or `uninstall()`). Calling unplug twice is a
no-op. If `install()` throws synchronously, whatever it registered so far is
rolled back before the error reaches you; if it returns a promise that
rejects, the rejection goes to the `'error'` event and nothing is rolled back.

### Dependencies between plugins (`requires`)

A plugin can list the plugins it needs by name. `bot.plug()` checks them
before running `install()` and throws a descriptive error when one is not
plugged:

```ts
const crm = definePlugin({ name: 'crm', version: '1.0.0', requires: ['inbox'], install(ctx) { /* … */ } })

bot.plug(crm)                        // Error: Plugin "crm" requires plugin(s) "inbox", which is not plugged…

const unplugInbox = bot.plug(inbox)  // ok: plug the dependency first...
const unplugCrm = bot.plug(crm)      // ...then the plugin that requires it
// plug() returns an unplug function, not the bot: one call per plugin, no chaining
```

The check runs at plug time only: unplugging `inbox` later does not unplug
`crm`. A plugin nested inside another one (`ctx.bot.plug()` from `install()`)
may require its parent.

### One instance per name (`multiple`)

`bot.plug()` refuses a plugin whose `name` is already plugged on the bot, so a
plugin registered twice by mistake never runs its handlers twice:

```ts
const unplug = bot.plug(inbox)
bot.plug(inbox)   // Error: Plugin "inbox" is already plugged on this bot…
unplug()
bot.plug(inbox, { tenant: 'b' })  // ok again: the first instance is gone
```

A plugin meant to run several times with different configs sets
`multiple: true` in its spec (every instance must set it). Each instance is
then unplugged on its own, and any of them satisfies `requires`.

### Built-in: slashCommands

Config: `{ greeting?: string; unknownMessage?: string }`. The command
prefix is a bot option (`new Bot({ commandPrefix })`), not a plugin option.
The replies are [built-in texts](./i18n#built-in-messages) in the bot's
language.

| Command | What it does |
|---|---|
| `/start` | Shows `greeting`, or the list of commands |
| `/help` | Same as `/start` |
| `/reset` | Cancels the active conversation and re-arms [`WELCOME`](./triggers#welcome), so the next message is a first contact again |
| `/cancel` | Cancels the active conversation only |
| `/id` | Shows the chat id |
| `/ping` | Health check (answers "pong 🏓") |

Unknown `/commands` get an automatic "unknown command" reply
(`unknownMessage`).

## Create a plugin

### Simple plugin

```ts
import { definePlugin } from '@botmesh/core'

const loggingPlugin = definePlugin({
  name: 'logging',
  version: '1.0.0',
  description: 'Log every message',
  install(ctx) {
    // ctx.bot        → Bot instance
    // ctx.logger     → the bot's logger
    // ctx.tools      → tools registry
    // ctx.config     → config passed to plug()
    // ctx.onDispose  → register teardown logic

    ctx.bot.before('message', async (c, next) => {
      ctx.logger.info(`📥 ${c.from}: ${c.body}`)
      await next()
    })
  },
})

bot.plug(loggingPlugin)
```

### Configurable plugin with cleanup

```ts
const rateLimitPlugin = definePlugin({
  name: 'rate-limit',
  version: '1.0.0',
  install(ctx, config: { max?: number; windowMs?: number } = {}) {
    const max = config.max ?? 10
    const windowMs = config.windowMs ?? 60000
    const counts = new Map()

    ctx.bot.before('message', async (c, next) => {
      const now = Date.now()
      let entry = counts.get(c.from)

      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + windowMs }
        counts.set(c.from, entry)
      }

      entry.count++
      if (entry.count > max) {
        await c.reply(`⏳ Wait ${Math.ceil((entry.resetAt - now) / 1000)}s`)
        c.abort()
        return
      }

      await next()
    })

    // runs when this plugin is unplugged (bot.plug() returned unplug())
    ctx.onDispose(() => counts.clear())
  },
})

bot.plug(rateLimitPlugin, { max: 20, windowMs: 60000 })
```

## Plugin structure

`definePlugin(spec)` returns the spec unchanged, typed. A plugin can also be a
function `(config) => spec`.

| Field | Required | What it is |
| --- | --- | --- |
| `name` | yes | Unique name. Plugging the same name twice throws unless `multiple` is set. |
| `version` | yes | The plugin's semver version. |
| `description` | no | Human description. |
| `requires` | no | Names of plugins that must be plugged first. |
| `multiple` | no | Allow several instances on one bot (default `false`). |
| `install(ctx, config)` | yes | Registers everything. Must be synchronous and return nothing (see below). |
| `uninstall(ctx)` | no | Runs first when the plugin is unplugged, before the automatic rollback. |

The `ctx` that `install` receives:

| Member | What it is |
| --- | --- |
| `ctx.bot` | The bot, scoped to the plugin: what you register through it is undone on unplug. |
| `ctx.logger` | The bot's logger (`LoggerLike`). |
| `ctx.tools` | The [injected tools](./di) registry. |
| `ctx.config` | The config passed to `bot.plug()`. |
| `ctx.onDispose(fn)` | Register cleanup to run on unplug. |

::: warning `install()` must be synchronous and return nothing
`bot.plug()` does not `await` `install()`. TypeScript rejects an `async install`
(or one that returns a promise or any other value) at compile time:
`PluginSpec.install` returns `void | SyncInstallError`, and the error message
names the reason. In JavaScript the bot keeps going before an `async install`
finishes, and its rejection only reaches the `'error'` event: nothing is rolled back and the plugin
counts as plugged; the ESLint rule
[`no-async-plugin-install`](./eslint#botmesh-no-async-plugin-install) covers that
case. If your plugin needs async setup (open a connection, load an SDK), keep
`install` synchronous and resolve lazily on first use, reporting configuration
errors without crashing. That's how `@botmesh/ai` loads its provider SDKs.
:::

## Plugin packages

Besides `slashCommandsPlugin`, these packages ship ready-made plugins:

- [AI](/guide/ai) — `@botmesh/ai`: LLM replies (`aiPlugin`), with
  [tools](/guide/ai-tools), [memory and RAG](/guide/ai-memory-rag) and
  [streaming](/guide/streaming).
- [Voice](/guide/voice) — experimental `@botmesh/voice` (`voicePlugin`):
  speech-to-text for inbound voice notes and text-to-speech replies.
- [Integrations](/guide/integrations) — experimental `@botmesh/chatwoot`,
  `@botmesh/tickets`, `@botmesh/moderation` and `@botmesh/dialogflow`.

## Next steps

- [Dependency injection](./di) — share tools between plugins
- [Example: rate limiter](/examples/rate-limiter) — full plugin
