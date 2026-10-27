# Instagram

Instagram DMs of a professional account connected to a Facebook Page
(Messenger API for Instagram).

## Install

```bash
pnpm add @botmesh/core @botmesh/instagram
```

## Usage

```ts
import { InstagramProvider } from '@botmesh/instagram'

const provider = new InstagramProvider({
  accessToken: process.env.META_PAGE_TOKEN!, // token of the connected Page
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Buttons go out as quick replies (at most 13, titles cut to 20 characters,
  unique ids and titles, attached to a non-empty text; anything else rejects
  with `UnsupportedContentError` instead of dropping options); lists degrade
  to numbered text. Every Send API request times out after
  `requestTimeoutMs` (60 s).
- DMs only (no groups); reactions arrive but cannot be sent.
- Text is capped at 1000 UTF-8 bytes (`maxTextBytes`, plus `maxTextLength`
  1000), so non-ASCII text fits less: longer text is split into several
  messages by bytes, and the `ctx.stream()` chunks fit too.
- Attachments carry no caption: a media caption goes out as a text message
  right after the attachment, and a card image after the card text (an
  image-only card sends just the image; one with neither is rejected).
- A DM with several photos arrives as one message per photo (ids `<mid>`,
  `<mid>#2`, `<mid>#3`…).
- While the bot is stopped, `ingest()` answers `503`, so Meta redelivers the
  webhook after the restart.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/instagram-provider)
