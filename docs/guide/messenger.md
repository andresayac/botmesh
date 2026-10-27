# Messenger

Facebook Messenger through the Graph Send API, with the same webhook
verification as the Cloud API.

## Install

```bash
pnpm add @botmesh/core @botmesh/messenger
```

## Usage

```ts
import { MessengerProvider } from '@botmesh/messenger'

const provider = new MessengerProvider({
  accessToken: process.env.FB_PAGE_TOKEN!, // Page access token (pages_messaging)
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Buttons and lists are native; reactions arrive but cannot be sent
  (subscribe the webhook to `message_reactions`; `emoji` is the character and
  `removed` is set on `unreact`).
- Text is capped at 2000 characters (`maxTextLength`): longer text is split
  into several messages, and `ctx.stream()` chunks fit the Send API.
- More than 3 buttons (button template) or 10 list rows (generic template)
  reject with `UnsupportedContentError` instead of dropping options.
- Each Send API call times out after `requestTimeoutMs` (60 s by default).
- No text is cut: a list sends its text before the generic template (which
  has no header), and button text past the template's 640 characters goes
  first as plain text.
- Several attachments in one message arrive as one message each (`<mid>`,
  `<mid>#2`…). An edited message (subscribe `message_edits`) arrives again
  with its original id; `isEditedMessage(ctx)` tells it apart.
- Message tags: `bot.send(psid, text, { platformData: { tag: 'HUMAN_AGENT' } })`
  sends after the 24-hour window (`messaging_type`, `notification_type` and
  `persona_id` are accepted too).
- While the bot is stopped, `ingest()` answers `503`, so Meta redelivers the
  webhook after the restart.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/messenger-provider)
