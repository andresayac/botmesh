# Coming from v1

botmesh 2 (`@botmesh/core`) is a rewrite of v1, which was published as
`@bot-wa/bot-wa-baileys` (`BaileysClass`). The engine is new and transport
agnostic: everything about the WhatsApp connection (session, QR, JIDs, auth)
moved into a **provider** you build and pass to the bot. This page summarizes
what changes; the step-by-step guide with before/after examples is
[`MIGRATION-v1-to-v2`](/MIGRATION-v1-to-v2) (in Spanish).

## What maps to what

| v1 | v2 |
| --- | --- |
| `new BaileysClass(opts)` | `new Bot({ provider: new BaileysProvider(opts) })` and `await bot.start()` |
| `import … from '@bot-wa/bot-wa-baileys'` | `import { Bot, flow } from '@botmesh/core'` and `import { BaileysProvider } from '@botmesh/baileys'` |
| `addKeyword().addAnswer(text, { capture })` | `flow(trigger).say(text)` / `.ask(text, stateKey)` (`addKeyword` remains as a deprecated alias of `flow`; `.addAnswer` and `.addAction` do not exist) |
| `sendText`, `sendImage`, `sendFile`… | `bot.send(chatId, content)` and the context helpers `ctx.reply`, `ctx.photo`, `ctx.file`… |
| `{ image: { url }, caption }` | `{ kind: 'image', media: { url }, caption }`: one transport-neutral content union |
| `ctx.key` / `ctx.rawMessage` | `ctx.ref` (`{ id, chatId, native? }`) / `ctx.raw` |
| `usePairingCode` + `pairing_code` event | `pairingPhoneNumber` on `BaileysProvider`; the code arrives in the `qr` event |
| `sendButtons` | Use `choose()` menus or `ctx.poll()` on Baileys; the Cloud API has native buttons |
| `bot.groups`, `bot.profile`, `bot.privacy`… | Removed from the core: see [Sub-APIs](./sub-apis) |

## Behaviour that changes

- **Text triggers match by normalized equality**, not "contains". Ask for
  `{ pattern, match: 'contains' }` where you relied on it
  ([Core concepts](./concepts)).
- **Type handlers (`onType`, `bot.when(IMAGE, …)`) are low specificity**: a
  more specific handler that matches wins unless it calls `ctx.pass()`.
- **The `'message'` event fires for every processed message**; the catch-all
  for unhandled messages is `bot.onMessage()`.
- **Group conversations are per participant** by default
  (`conversationScope: 'chat'` restores one per chat).
- **ESM only, Node.js 22 or newer** (see [Packages and versions](./packages)).
- **`.persistent()` flows survive a restart only with a persistent store**
  ([Persistent store](./store)).

## Tools that help

- The ESLint rule [`botmesh/no-v1-api`](./eslint#botmesh-no-v1-api) flags the
  v1 and BuilderBot calls that no longer exist and names the replacement.
- [Channels](./channels) lists every provider that replaces the built-in
  WhatsApp connection.

## Next steps

- [Quick start](./getting-started): a v2 project from scratch.
- [Conversation flows](./flows): the `flow()` DSL in detail.
- [Upgrade guide](./stable-migration): moving between 2.0 prereleases.
