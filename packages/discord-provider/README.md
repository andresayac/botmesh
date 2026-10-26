# @botmesh/discord

**Discord** transport for [`@botmesh/core`](https://github.com/andresayac/botmesh/tree/main/packages/core): **Gateway websocket**
for inbound events (messages, buttons, menus and slash commands) and **REST**
to send. The provider owns the socket (`pushIngress: false`) — there is no
webhook to wire up.

## Install

```bash
pnpm add @botmesh/core @botmesh/discord
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build (or to none). Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/discord@beta` during the beta (`npm view @botmesh/discord dist-tags` lists the tags). Once stable, the plain command above works.

Dependencies: `ws` (gateway) and Node 22+ native `fetch`/`FormData` (REST).
Media downloads go through the SSRF-safe
[`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http).

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
`ctx.interaction` (`id` = the interaction id, `respondBy` = deadline epoch ms).
The interaction token never leaves the provider (it remembers it by id for its
15-minute lifetime). The core acknowledges each interaction exactly once for
you: a deferred ack (type 6 for components, type 5 for commands and modals)
before the handler's first send, shortly before the deadline, or when the
handler ends, whichever comes first. To answer with an immediate text reply
(type 4) instead, call `ctx.acknowledge(text)` before replying:

```ts
bot.when('confirm', async (ctx) => {
  await ctx.acknowledge?.('Done ✅')  // optional: immediate text reply (type 4)
  await ctx.reply('Order confirmed')  // without the line above, a deferred ack goes out first
})
```

Once the automatic ack went out, `ctx.acknowledge(text)` sends `text` as a
normal message and `ctx.acknowledge()` is a no-op. Outside a handler,
`provider.acknowledgeInteraction(interactionId, { text? })` acks directly.
Once an interaction is acknowledged, a later call with `text` sends it as a
followup and a call without text is a no-op. The followup needs the
application id: `appId`, or else the one Discord sends on READY and on each
interaction; when none is known, the call rejects with `ProviderError`
instead of dropping the text. Only ids the provider received are known: the
token is never passed in.

As a backstop (for example an interaction that never reaches a bot handler),
the provider itself defers any interaction still unanswered after
`autoAcknowledgeMs` (default `2000`; autocomplete is never deferred). `autoAcknowledgeMs: false` turns that off.

REST requests time out after `requestTimeoutMs` (default 60000) and file uploads
after `uploadTimeoutMs` (default 300000). More than 25 buttons or 25 select
options reject with `UnsupportedContentError` instead of being cut.

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
| **Polls** (24h poll; votes are not delivered as events) | ✅ send |
| Reactions (PUT `.../reactions/{emoji}/@me`; one per message, `react('')` removes it: see below) | ✅ |
| Typing, editing and deleting messages | ✅ |
| Inbound edits (`MESSAGE_UPDATE` with `edited_timestamp`) → message with the original `ref.id`; `isEditedMessage(ctx)`, `editedMessages: 'ignore'` drops them | ✅ |
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

## Mentions

Discord pings whatever the content mentions unless the message says otherwise. A
bot that echoes text (a user's message, an AI answer) could then ping
`@everyone`, `@here` or a role. The provider adds `allowed_mentions` to every
message that sets none, `{ parse: ['users'] }` by default: `<@user>` mentions
still notify, `@everyone`, `@here` and role mentions do not.

- `allowedMentions` changes that default (`{ parse: [] }` pings nobody,
  `{ parse: ['users', 'roles', 'everyone'] }` is Discord's own behaviour).
- `SendOptions.mentions` sends `{ users: [...] }` (only those users),
  `platformData.allowed_mentions` replaces it for one send, and a `native`
  payload is sent exactly as written.
- A reply (`ctx.quote()`, `SendOptions.quoted`) still pings the author of the
  replied message: the provider adds `replied_user: true`, because Discord turns
  that ping off once `allowed_mentions` is present. Set
  `allowedMentions: { parse: ['users'], replied_user: false }` to reply silently.

## Typed errors

REST failures (HTTP ≥ 400) map to `@botmesh/core` errors (`toDiscordError`):
`429` → `RateLimitedError` (with `retryAfterMs` from `retry_after`), `403` →
`RecipientUnreachableError` (also codes 10003 *Unknown Channel*,
10013 *Unknown User*, 50001 *Missing Access* and 50007 *Cannot send messages to
this user*), `413`/code 40003 → `PayloadTooLargeError`, the rest →
`ProviderError` with Discord's `message`. A reaction with an empty emoji is
rejected with `UnsupportedContentError` (Discord cannot remove a reaction
without knowing which one).

Ids reach REST URLs as single path segments: each one is percent-encoded and an
empty, `.` or `..` id rejects with `ProviderError` (`Invalid Discord channel id`),
so a crafted `chatId` or message id can never reach another route with the bot
token.

## Identity

`chatId` is the channel snowflake (`channel_id`) and `senderId` the user's
(`author.id` / `member.user.id`) — stable, with no member-vs-user ambiguity.
A message with no text and no file is a `sticker` (with the sticker image as
media when it has one) or `unknown` (embeds only, or the Message Content intent
is off), never an empty `text` that would answer an `ask()`.
Bot messages (including the bot's own) and system messages (member joins,
pins, boosts, thread notices: any `type` other than 0 *default* and 19
*reply*) are ignored. Malformed gateway frames are dropped with a warning and
an error thrown by a dispatch handler is logged, never raised into the socket.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `token` | required | Bot token (Developer Portal → Bot → Reset Token), without the `Bot ` prefix. An empty value or one starting with `Bot ` throws in the constructor; surrounding whitespace (a trailing newline from a secrets file) is trimmed. |
| `intents` | `Guilds \| GuildMessages \| MessageContent` (`DEFAULT_INTENTS`) | Gateway intents bitmask; add `GatewayIntents.DirectMessages` for DMs. |
| `appId` | learnt from READY / the interaction | Application id for interaction followups. |
| `selfId` | learnt from READY | The bot's own user id (`fromMe`). |
| `editedMessages` | `'deliver'` | `'ignore'` drops `MESSAGE_UPDATE` edits. |
| `autoAcknowledgeMs` | `2000` | Defer an interaction nobody answered after this many ms (below 3000); `false` turns it off. |
| `allowedMentions` | `{ parse: ['users'] }` | `allowed_mentions` of every message that sets none (see [Mentions](#mentions)). |
| `reactionMemory` | `1000` | Messages whose bot reaction is remembered (see [Bot reactions](#bot-reactions)); `0` disables replace/remove. |
| `requestTimeoutMs` | `60000` | Client timeout per REST request. |
| `uploadTimeoutMs` | `300000` | Client timeout of a request that uploads files. |
| `mediaDownload` | `@botmesh/http` defaults | Download policy for attachments (`maxBytes`, `timeoutMs`, ...). |
| `mediaRefHosts` | `DISCORD_MEDIA_HOSTS` | Hosts whose attachment URLs are journaled for a durable replay. |
| `gatewayUrl` / `apiUrl` / `apiVersion` | `wss://gateway.discord.gg` / `https://discord.com/api` / `v10` | Endpoints (a proxy or a local simulator). |
| `reconnectDelayMs` | `500` | Base of the gateway reconnect backoff. |
| `socketFactory` | `ws` | Injectable websocket factory (tests). |
| `logger` | pino, `error` level | Any `LoggerLike` (pino, `console`, ...). `debug: true` is deprecated: pass a logger. |

## Entries

- `@botmesh/discord`: `DiscordProvider`, `isEditedMessage`, `toDiscordError`,
  `GatewayIntents`, `DEFAULT_INTENTS`, `DISCORD_MEDIA_HOSTS` and the config types
  (`DiscordProviderConfig`, `DiscordAllowedMentions`, `SocketLike`, `SocketFactory`,
  `DiscordApiErrorBody`).
  Covered by semver.
- `@botmesh/discord/internal`: the gateway socket, REST client, payload mappers,
  protocol constants and Discord payload types, for tests and custom tooling.
  **No semver**: they may change in any release.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Messages arrive with an empty body | The **Message Content** privileged intent is off: enable it in the Developer Portal (Bot → Privileged Gateway Intents). |
| `connection` closes with `reason: 'sessionInvalid'` right after `start()` | Invalid token (close code 4004) or intents the portal does not allow (4013/4014). Reset the token or enable the intents. |
| The bot never sees DMs | Add `GatewayIntents.DirectMessages` to `intents`. |
| A button shows "This interaction failed" | Nothing answered within ~3 s: keep `autoAcknowledgeMs` on, or call `ctx.acknowledge()` early in the handler. |
| `ctx.acknowledge('text')` rejects with `ProviderError` | The followup needs the application id and none is known yet: pass `appId`. |
| `ctx.react('')` rejects with `UnsupportedContentError` | The bot's previous emoji on that message is not remembered (restart, LRU eviction or `reactionMemory: 0`). |
| A send rejects with `RecipientUnreachableError` | Missing permissions in the channel, or the user closed DMs (codes 50001, 50007). |

## Notes

- Timestamps are epoch **milliseconds** (from the snowflake).
- Only one process should own a bot token's gateway session: with
  `BotConfig.coordination`, the provider only connects on the leader replica
  (`exclusiveSession`).
- ESM only, Node.js 22 or later.

## Links

- [Channels guide](https://andresayac.github.io/botmesh/guide/channels#botmesh-discord) · [Streaming replies](https://andresayac.github.io/botmesh/guide/streaming) · [Security](https://andresayac.github.io/botmesh/guide/security) · [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/discord-provider/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/discord-provider) · [Issues](https://github.com/andresayac/botmesh/issues)
