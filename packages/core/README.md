# @botmesh/core

[![Docs](https://img.shields.io/badge/docs-guides-blue)](https://andresayac.github.io/botmesh/)
[![npm](https://img.shields.io/npm/v/@botmesh/core)](https://www.npmjs.com/package/@botmesh/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/andresayac/botmesh/blob/main/LICENSE.md)

A **transport-agnostic** bot engine: declarative flows to get going in 30 seconds, an async conversation runtime when you need full control, hooks, plugins, dependency injection and a scheduler. You inject the transport: WhatsApp through [`@botmesh/baileys`](https://www.npmjs.com/package/@botmesh/baileys) or the Cloud API ([`@botmesh/meta`](https://www.npmjs.com/package/@botmesh/meta)), Telegram through [`@botmesh/telegram`](https://www.npmjs.com/package/@botmesh/telegram); every channel implements the same `IProvider` contract.

> **v2 is a transport-agnostic rewrite.** If you come from v1 (`BaileysClass`), read the [migration guide](https://andresayac.github.io/botmesh/MIGRATION-v1-to-v2).

## Installation

```bash
npm install @botmesh/core @botmesh/baileys
```

> **Prerelease:** until the stable release, the packages are published only under a prerelease dist-tag, so add it to every `@botmesh/*` package: `npm install @botmesh/core@alpha @botmesh/baileys@alpha`.

Requires **Node >= 22** and ESM (`"type": "module"`). The core has no transport dependency: the transport package you pick brings its own.

## Quickstart (30 seconds)

```ts
import { Bot, flow } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({
  provider: new BaileysProvider({
    session: 'my-bot',
    qr: { terminal: true },        // print the QR in the terminal
  }),
})

bot.when('hola', (ctx) => ctx.reply('👋 Hello!'))

bot.use(
  flow('signup')
    .say('📝 Let us sign you up')
    .ask('Your name?', 'name')
    .say((_ctx, c) => `✅ Hi ${c.state.name}`)
)

// Advanced: async conversation with full control
bot.conversation('support', async (c, ctx) => {
  await ctx.reply('Describe your problem')
  const problem = await c.waitText({ timeout: '2m' })
  await ctx.reply(`🎫 Logged: ${problem}`)
})

await bot.start()   // scan the QR
```

A full example (commands, media, hooks, DI, scheduler) lives in [`packages/baileys-provider/examples/bot.ts`](https://github.com/andresayac/botmesh/blob/main/packages/baileys-provider/examples/bot.ts).

No camera? Set `pairingPhoneNumber: '+57300XXXXXXX'` on `BaileysProvider` (full international format) and listen for `bot.on('qr', ...)`: the pairing code arrives there too.

No phone at hand? Export the bot as a `defineBot()` factory and `npx botmesh dev src/bot.js` lets you chat with it in the terminal (see the [terminal simulator](https://andresayac.github.io/botmesh/guide/dev-simulator)).

> **Persistent flows:** `flow(...).persistent()` only survives a restart with a persistent store. The default `MemoryStore` lives in RAM; to keep checkpoints use a disk-backed store (e.g. [`@botmesh/sqlite-store`](https://github.com/andresayac/botmesh/tree/main/packages/sqlite-store)).

## Features (v2)

- **Transport-agnostic engine** — the core knows nothing about WhatsApp: `IProvider` normalizes input (`InboundEvent`) and output (`OutboundContent`); each transport resolves its own identity internally.
- **Declarative flows that compile to an async runtime** — `flow().say().ask().choose()` compiles to a real `bot.conversation`.
- **Dispatcher by specificity** — commands (`/reset`) > active conversation > matchers (normalized `equals` by default, or `contains`/`startsWith`/`endsWith`) > catch-all.
- **Async conversation runtime** — `c.ask`, `c.waitText`, `c.waitMedia`, `c.waitLocation`, `c.choose`, with validation, retries and per-wait timeouts.
- **Projected interactions** — button/slash clicks arrive as a `type: 'buttons'` message with `ctx.acknowledge()` (no-op on WhatsApp); on transports with `interactionsRequireAck` (Discord) the core acks on its own.
- **Runtime config validation** — the constructor throws `ConfigValidationError` with a clear message.
- **Group mode** — `config.groupMode: 'all' | 'mentions' | 'commands'`.
- **One contract on every channel** — `ctx.timestamp` is epoch milliseconds everywhere, and a text longer than the channel allows (`capabilities.maxTextLength` / `maxTextBytes`) is split into several messages at paragraph, sentence or word boundaries, never inside an emoji or the markup (`splitLongText: false` opts out). Provider authors check the contract with `assertInboundContract` and `assertCapabilityContract` from `@botmesh/core/testing`.
- **Graceful shutdown with drain** — `bot.stop({ drain: true })` waits for in-flight sends.
- **Testing kit without a real transport** — `createTestBot()` from `@botmesh/core/testing`, with `MockProvider`, chat helpers (`chat.send()`, `chat.expectReply()`) and Vitest matchers.
- **Hooks and plugins with DI** — `before`/`after`/`onError`, `bot.plug()`/`unplug()`, `bot.provide()`.
- **Built-in scheduler** — `bot.schedule()` (cron), `bot.every()`, `bot.delay()`.
- **100% ESM + strict TypeScript.**

> Note: the v1 WhatsApp management sub-APIs (`bot.groups/profile/privacy/chats/presence`) are not part of the transport-agnostic core; see [Sub-APIs](https://andresayac.github.io/botmesh/guide/sub-apis) for what replaces them.

## Entry points

| Import from | For |
| --- | --- |
| `@botmesh/core` | Applications: `Bot`, the flow DSL, message types, options and errors. |
| `@botmesh/core/testing` | Tests: `createTestBot`, `MockProvider`, chaos kit, golden transcripts, `MemoryCoordinator`. |
| `@botmesh/core/spi` | Authors of stores, durability backends, schedule stores, coordinators, tracer integrations and transports (`KvDurability`, `MemoryKv`, `MemoryScheduleStore`, `messageKey`, `toInboundLocation`, record types). Covered by semver. |
| `@botmesh/core/dev` | The `botmesh dev` terminal simulator. |
| `@botmesh/core/internal` | Engine classes and helpers. No semver guarantee. |

Coming from an earlier alpha? Follow the [upgrade checklist](https://andresayac.github.io/botmesh/guide/stable-migration#upgrade-checklist).

## Persistent store (SQLite)

The default `MemoryStore` is ideal for development. For production use the [`@botmesh/sqlite-store`](https://github.com/andresayac/botmesh/tree/main/packages/sqlite-store) package:

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'my-bot' }),
  store: new SQLiteStore({ file: './data/bot.db' }),
})
```

## Group mode

```ts
const bot = new Bot({
  provider,
  groupMode: 'mentions',  // only answer when @mentioned
  // groupMode: 'commands',  // only answer commands
  // groupMode: 'all',       // answer everything (default)
})
```

## Documentation

- [Guide](https://andresayac.github.io/botmesh/guide/getting-started): getting started, flows, hooks, plugins, testing
- [Configuration reference](https://andresayac.github.io/botmesh/guide/configuration): every `new Bot()` option, events and errors
- [API reference](https://andresayac.github.io/botmesh/api/) (TypeDoc)
- [Migration guide v1 → v2](https://andresayac.github.io/botmesh/MIGRATION-v1-to-v2)

## Acknowledgements

Inspired by ideas and code from [bot-whatsapp](https://github.com/codigoencasa/bot-whatsapp) by codigoencasa.

## License

[MIT](https://github.com/andresayac/botmesh/blob/main/LICENSE.md) © Andres Aya
