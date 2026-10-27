# HighLevel (GoHighLevel)

HighLevel (GoHighLevel / LeadConnector) Conversations API. Inbound through
the `InboundMessage` webhook (Ed25519 `X-GHL-Signature`), outbound with
`POST /conversations/messages` on the channel the contact last used.

## Install

```bash
pnpm add @botmesh/core @botmesh/gohighlevel
```

## Usage

```ts
import { GoHighLevelProvider } from '@botmesh/gohighlevel'

const provider = new GoHighLevelProvider({
  accessToken: process.env.GHL_TOKEN!,         // Private Integration Token
  locationId: process.env.GHL_LOCATION_ID!,
  // defaultChannel: 'SMS',                    // until the contact writes
})
```

- `chatId` = HighLevel `contactId`: one chat per contact across channels;
  the channel of each message is in `ctx.chat.platformData.channel`.
- HighLevel's public key is bundled (`GHL_WEBHOOK_PUBLIC_KEY`), so no
  webhook secret is needed. `ingest()` needs the **raw** body.
- Media only from public URLs; `template` maps to `templateId`.
- An Email's HTML body arrives as plain text in `ctx.body`; `ctx.raw.body`
  keeps the HTML and `ctx.chat.platformData.subject` the subject.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/gohighlevel-provider)
