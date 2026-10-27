# Baileys (WhatsApp Web)

WhatsApp Web through [Baileys](https://github.com/WhiskeySockets/Baileys).
Links with a QR code (or a pairing code, `pairingPhoneNumber`) and keeps the session in
`sessionsDir` (`./sessions/<session>`): later starts reconnect without a QR. It
depends on the exact `@whiskeysockets/baileys` `7.0.0-rc14` (there is no stable
Baileys 7 yet); the README explains the pin and the upgrade policy.

## Install

```bash
pnpm add @botmesh/core @botmesh/baileys
```

## Usage

```ts
import { BaileysProvider } from '@botmesh/baileys'

const provider = new BaileysProvider({ session: 'my-bot' })
```

- Socket owned by the provider, with reconnection and backoff
  (`reconnect: { maxAttempts, baseMs, capMs }` tunes it, `false` turns it
  off).
- LID and phone-number forms of a user are merged into one stable
  `senderId`.
- No native buttons or lists (WhatsApp Web dropped them): use `choose()`
  menus or `ctx.poll()`.
- Anti-ban send rate limiting is on by default (`rateLimit`).
- Reactions and deletes arrive as events, never as messages, so a
  catch-all handler or an open `ask` does not take them as text. A **text
  edit** arrives as a message with the new text and the original `ref.id`,
  like on Telegram: `isEditedMessage(ctx)` (from `@botmesh/baileys`) tells it
  apart, and `editedMessages: 'ignore'` drops edits. Only the author of a
  message this process has seen can edit it: an edit of someone else's
  message, of the bot's own or of an original no longer cached is dropped.
- `ctx.voice()` and `ctx.sticker()` accept URLs and streams (downloaded with
  the same SSRF checks as other media); `ctx.poll()` needs 2 to 12 unique
  options.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Rate limiting (anti-ban)](/guide/rate-limiting): the send pacing that is on by default.
- [Sub-APIs](/guide/sub-apis): groups, profile and privacy through the native socket.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/baileys-provider)
