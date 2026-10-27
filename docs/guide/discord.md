# Discord

Discord gateway (WebSocket) for events plus REST for sending.

## Install

```bash
pnpm add @botmesh/core @botmesh/discord
```

## Usage

```ts
import { DiscordProvider, GatewayIntents } from '@botmesh/discord'

const provider = new DiscordProvider({ token: process.env.DISCORD_TOKEN! })
// Default intents: Guilds | GuildMessages | MessageContent.
// Add GatewayIntents.DirectMessages to the `intents` bitmask to receive DMs.
```

- Buttons, select menus, polls, reactions and edits are native;
  `ctx.stream()` edits one message as the text grows.
- The bot keeps one reaction per message, like WhatsApp/Telegram: a new
  `ctx.react(emoji)` replaces its previous one and `ctx.react('')` removes it.
  Discord deletes reactions by emoji, so the provider remembers the emoji it
  set (in memory, `reactionMemory`, default 1000 messages); an unknown one
  (set before a restart, or evicted) rejects with `UnsupportedContentError`.
- Interactions have a hard acknowledgement deadline
  (`interactionsRequireAck`), so the core acknowledges each one exactly once
  for you: a deferred ack before the handler's first send, shortly before the
  ~3 s deadline, or when the handler ends, whichever comes first. Call
  `ctx.acknowledge('text')` before replying to answer with an immediate text
  instead; once the automatic ack went out, `ctx.acknowledge('text')` sends
  `text` as a normal reply and `ctx.acknowledge()` does nothing.
- `ctx.interaction.id` is the bare interaction id: its token stays inside the
  provider. As a backstop, the provider also defers any interaction still
  unanswered after `autoAcknowledgeMs` (default 2000 ms; `false` turns it off). A late `ctx.acknowledge('text')` after the ack goes
  out as a followup, with `appId` or else the application id Discord sends on
  READY and on each interaction; if none is known the call rejects with
  `ProviderError` instead of dropping the text.
- More than 25 buttons (5 rows of 5), 25 select-menu options or 10 poll
  answers reject with `UnsupportedContentError` instead of dropping options;
  text over 2000 characters is split into several messages.
- Each REST call times out after `requestTimeoutMs` (60 s by default); file
  uploads after `uploadTimeoutMs` (5 min).
- System messages (member joins, pins, boosts...) and messages from bots are
  not routed. A message with no text and no file arrives as `sticker` (with the
  sticker image as media) or `unknown` (embeds only, or the Message Content
  intent is off), never as an empty text.
- Every message the provider sends carries `allowed_mentions` (default
  `{ parse: ['users'] }`, option `allowedMentions`), so echoed text cannot ping
  `@everyone`, `@here` or a role; `SendOptions.mentions`,
  `platformData.allowed_mentions` and `native` payloads override it. A quoted
  reply still pings the replied author (`replied_user: true`; set
  `allowedMentions.replied_user: false` to reply silently).
- Ids go into REST URLs percent-encoded, and an empty, `.` or `..` id rejects
  with `ProviderError`: a crafted id never reaches another route. Native poll
  votes are not delivered as events.
- A forwarded message carries the forwarded text and media (from its
  snapshot), not a quoted reply; one with nothing readable arrives as
  `unknown`. A native poll arrives as `type: 'poll'` with its question as body.
- **Edited messages** (`MESSAGE_UPDATE` with `edited_timestamp`) arrive as
  messages with the new text and the original `ref.id`; `isEditedMessage(ctx)`
  from `@botmesh/discord` tells them apart and `editedMessages: 'ignore'` drops
  them. Other updates (embed unfurls, pins, flags) are not routed: the provider
  delivers an edit once per `edited_timestamp` (it remembers the last one for
  the 1000 most recently edited messages), so pinning an edited message does not
  re-deliver it.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Streaming replies](/guide/streaming): one message edited as the text grows.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/discord-provider)
