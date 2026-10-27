# TikTok

::: warning Experimental: private package
`@botmesh/tiktok` is private (`"private": true`): it is not on npm and its API may change. Use it from a clone of the monorepo (`"workspace:*"`). See [Packages and versions](/guide/packages).
:::

TikTok API for Business (v1.3): **comments** on the account's own videos and
**direct messages** (Business Messaging API, approval required). Webhooks
verified with `TikTok-Signature`.

## Install

It is not on npm: depend on it from a package inside the monorepo.

```json
{ "dependencies": { "@botmesh/core": "workspace:*", "@botmesh/tiktok": "workspace:*" } }
```

## Usage

```ts
import { TikTokProvider } from '@botmesh/tiktok'

const provider = new TikTokProvider({
  accessToken: process.env.TIKTOK_TOKEN!,             // or an async refresh function
  businessId: process.env.TIKTOK_BUSINESS_ID!,        // open_id of the account
  appSecret: process.env.TIKTOK_APP_SECRET!,          // verifies TikTok-Signature
  selfUniqueIdentifier: process.env.TIKTOK_SELF_UID!, // required to receive comments
})
```

- Chats: `dm:<conversation_id>` (DM), `comment:<video_id>:<comment_id>`
  (comment thread, a group chat) and `hic:<comment_id>` (high-intent
  comment). `ctx.chat.platformData.surface` tells them apart.
- DMs: text (up to 6000 characters), images, Q&A cards for buttons (1 to
  3); comments: text replies up to 150 characters. Buttons or lists a Q&A
  card cannot hold (more than 3 options, URL buttons, titles over 40
  characters) and menus sent to a comment thread degrade to a numbered text
  menu, as on Baileys.
- The bot cannot start a conversation, and TikTok limits messages per 48 h
  window (`OutsideSessionWindowError`).

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/tiktok-provider)
