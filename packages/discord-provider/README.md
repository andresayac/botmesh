# @botmesh/discord

> **Experimental — not yet published on npm.** Real, tested implementation, but the package is `private`: it is not part of the first alpha and its API may change. Use it from this monorepo (`workspace:*`); the `pnpm add` below will work once it is published.

**Discord** transport for [`@botmesh/core`](../core): **Gateway websocket**
for inbound events (messages, buttons, menus and slash commands) and **REST**
to send. The provider owns the socket (`pushIngress: false`) — there is no
webhook to wire up.

## Install

```bash
pnpm add @botmesh/core @botmesh/discord
```

Dependencies: `ws` (gateway), Node ≥ 22 native `fetch`/`FormData` (REST).

## Requirements (Discord)

1. An application in the [Developer Portal](https://discord.com/developers/applications) with a **Bot**.
2. The **bot token** (Bot → Reset Token).
3. **Privileged Gateway Intents** enabled (Bot → Privileged Gateway Intents):
   - `MESSAGE CONTENT INTENT` — **required**, without it `content` arrives empty.
   - `SERVER MEMBERS INTENT` — only if you need members.
4. Invite the bot with the `bot` + `applications.commands` scopes and permission to
   read/send messages.

## Usage

```ts
import { Bot } from '@botmesh/core'
import { DiscordProvider, GatewayIntents } from '@botmesh/discord'

const provider = new DiscordProvider({
  token: process.env.DISCORD_TOKEN!,
  // Optional: on top of Guilds|GuildMessages|MessageContent (default),
  // add DirectMessages to receive DMs:
  intents: GatewayIntents.Guilds
    | GatewayIntents.GuildMessages
    | GatewayIntents.MessageContent
    | GatewayIntents.DirectMessages,
  appId: process.env.DISCORD_APP_ID, // optional: followups inside interactions
})

const bot = new Bot({ provider })
bot.when('hello', (ctx) => ctx.reply('👋 Hello from Discord!'))
await bot.start()
```

### Buttons and interactions

Discord requires an interaction to be answered within **~3 seconds**
(`interactionsRequireAck: true`). Button clicks / menu selections /
slash commands are routed like messages (the button `custom_id`, the
selected option value or the command name is the body) and carry
`ctx.interaction` (`id` = `"<id>:<token>"`, `respondBy` = deadline epoch ms).
Answer each one once from the handler. If no handler does within
`autoAcknowledgeMs` (default `2000`), the provider defers it on its own
(type 6 for components, type 5 for commands and modals), so Discord never
shows "This interaction failed"; a later `ctx.acknowledge('text')` is then
posted as a followup (needs `appId`). `autoAcknowledgeMs: false` turns it off.

```ts
bot.when('confirm', async (ctx) => {
  await ctx.acknowledge?.()          // deferred update (type 6), before the deadline
  // …or: await ctx.acknowledge?.('Done ✅') — an immediate text reply (type 4)
  await ctx.reply('Order confirmed')
})
```

Outside a handler, `provider.acknowledgeInteraction(interactionId, { text? })`
does the same; acknowledge an interaction only once.

### Gateway (technical note)

`start()` opens `wss://gateway.discord.gg/?v=10&encoding=json` and implements the
minimum protocol: HELLO → heartbeat + IDENTIFY, sequence tracking,
RESUME after drops (with backoff), reconnection with a new session on a
non-resumable INVALID_SESSION, and a definitive stop on fatal codes
(4004 invalid token, 4013/4014 intents — emits `connection` with
`reason: 'sessionInvalid'`). For tests, a fake socket is injected through
`socketFactory` (a real connection is never opened).

## What it supports

| Feature | Discord |
|---|---|
| Text, image, video, audio, voice, document, sticker (`files[0]` multipart + `payload_json`) | ✅ |
| **Buttons** (`components`: rows of 5, up to 25 buttons; URL buttons style 5) | ✅ native |
| **Lists** → select menu (type 3); the interaction carries the chosen row id in `data` | ✅ native |
| Card → embed (`title`/`description`/`image`) | ✅ |
| **Polls** (24h poll) | ✅ |
| Reactions (PUT `.../reactions/{emoji}/@me`; one per message, `react('')` removes it: see below) | ✅ |
| Typing, editing and deleting messages | ✅ |
| Interactions: button / menu / slash command with mandatory ack (~3s) | ✅ |
| Groups (guilds) and DMs (with the `DirectMessages` intent) | ✅ |
| Templates (kind `template`) | ❌ (does not exist in Discord) |
| Presence, read receipts (no `markRead()`) | ❌ (not applicable) |
| More than 25 buttons or menu options, more than 10 poll answers | ❌ `UnsupportedContentError` (nothing is dropped silently) |
| Text over 2000 characters | ✅ split into several messages by `@botmesh/core` |
| Location / contact | ⚠️ explicit degradation to text (map link / text card) |
| `native` (`ctx.sendNative('discord', createMessagePayload)`) | ✅ (another provider id → `UnsupportedContentError`) |

## Bot reactions

Discord allows several reactions per user and deletes them **per emoji**
(`DELETE .../reactions/{emoji}/@me`). So that `ctx.react()` behaves the same
as on WhatsApp and Telegram, the provider remembers the emoji the bot put on
each message (in-memory LRU, `reactionMemory`, 1000 messages by default):

- `ctx.react('✅')` on a message where the bot already reacted with `⏳` adds
  `✅` and then removes `⏳` (one bot reaction per message; if removing the
  previous one fails, only a warning is logged).
- `ctx.react('')` removes the remembered reaction.
- If the emoji is unknown (it was set before the process restarted, evicted
  from the LRU or `reactionMemory: 0`), `react('')` rejects with
  `UnsupportedContentError` instead of guessing. With `reactionMemory: 0`
  there is no replacement either: each emoji adds up to the previous ones.

## Typed errors

REST failures (HTTP ≥ 400) map to `@botmesh/core` errors:
`429` → `RateLimitedError` (with `retryAfterMs` from `retry_after`), `403` →
`RecipientUnreachableError` (also codes 10003 *Unknown Channel*,
10013 *Unknown User*, 50001 *Missing Access* and 50007 *Cannot send messages to
this user*), `413`/code 40003 → `PayloadTooLargeError`, the rest →
`ProviderError` with Discord's `message`. A reaction with an empty emoji is
rejected with `UnsupportedContentError` (Discord cannot remove a reaction
without knowing which one).

## Identity

`chatId` is the channel snowflake (`channel_id`) and `senderId` the user's
(`author.id` / `member.user.id`) — stable, with no member-vs-user ambiguity.
Bot messages (including the bot's own) and system messages (member joins,
pins, boosts, thread notices: any `type` other than 0 *default* and 19
*reply*) are ignored. Malformed gateway frames are dropped with a warning and
an error thrown by a dispatch handler is logged, never raised into the socket.

## Full configuration

```ts
new DiscordProvider({
  token: '…',                 // required (an empty value fails in the constructor)
  intents?: number,           // default: Guilds | GuildMessages | MessageContent
  appId?: string,             // for interaction followups (SendOptions.interactionId)
  selfId?: string,            // auto-detected from the gateway READY
  gatewayUrl?: string,        // default 'wss://gateway.discord.gg'
  apiUrl?: string,            // default 'https://discord.com/api' (no version)
  apiVersion?: string,        // default 'v10'
  socketFactory?: SocketFactory, // tests: fake socket
  reconnectDelayMs?: number,  // reconnection backoff base, default 500
  requestTimeoutMs?: number,  // client timeout per REST request, default 60000
  autoAcknowledgeMs?: number | false, // defer unanswered interactions after this many ms, default 2000
  debug?: boolean, logger?: Logger,
})
```
