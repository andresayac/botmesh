# WPPConnect

[WPPConnect Server](https://github.com/wppconnect-team/wppconnect-server),
a self-hosted gateway on WhatsApp Web (WA-JS). REST with a Bearer token;
webhooks authenticated with a token in the webhook URL.

## Install

```bash
pnpm add @botmesh/core @botmesh/wppconnect
```

## Usage

```ts
import { WPPConnectProvider } from '@botmesh/wppconnect'

const provider = new WPPConnectProvider({
  baseUrl: 'http://localhost:21465',
  session: 'my-bot',
  secretKey: process.env.WPP_SECRET_KEY!,       // or token: '<generated bearer>'
  webhookToken: process.env.WPP_WEBHOOK_TOKEN!, // webhook URL: …/webhooks/wpp?token=<it>
})
// POST /webhooks/wpp → res.sendStatus(await provider.ingest(body, headers, req.originalUrl))
```

- `ingest()` is **async** and takes the request URL as third argument,
  because wppconnect-server cannot add headers: the token travels in the
  query string.
- Unknown LIDs are resolved to phone numbers (`contact/pn-lid`) before
  emitting.
- `markRead` marks the whole chat as seen; buttons and lists degrade to
  numbered text.
- The connection follows the server's `status-find` webhooks: `isLogged` /
  `qrReadSuccess` → `ready`, `notLogged` and `qrcode` → `authenticating`,
  unlinking the device from the phone (`disconnectedMobile`) → `closed`
  with `sessionInvalid`. `bot.stop()` does not close the session on the
  server.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Evolution API](/guide/evolution): the other self-hosted gateway, sharing `@botmesh/wa-gateway-kit`.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/wppconnect-provider)
