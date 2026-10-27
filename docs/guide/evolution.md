# Evolution API

[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2, a
self-hosted WhatsApp REST gateway built on Baileys. Outbound: REST with the
`apikey` header. Inbound: the instance webhook, authenticated with a shared
secret header or Evolution's `jwt_key` (HS256 JWT).

## Install

```bash
pnpm add @botmesh/core @botmesh/evolution
```

## Usage

```ts
import { EvolutionProvider } from '@botmesh/evolution'

const provider = new EvolutionProvider({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.EVOLUTION_API_KEY!,
  instance: 'my-instance',
  webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET!, // or webhookJwtKey
})
// POST /webhook/evolution → res.sendStatus(provider.ingest(body, headers))
```

- `start()` checks the instance; when it is not paired, the QR or pairing
  code arrives in the `connection` update (`authPayload`).
- LID/PN twins sent by Evolution are reconciled before emitting; pass
  `identityPersistence` to keep ids stable across restarts.
- Polls, reactions, edits (text), typing and read receipts; buttons, lists
  and cards degrade to numbered text; `template` is rejected, and so is a
  poll WhatsApp cannot carry (fewer than 2 or more than 12 options, empty or
  repeated ones).
- If Evolution stops offering QR codes before the number is paired
  (`QRCODE_LIMIT`), the `connection` update is `closed` with reason
  `sessionInvalid`: call `start()` again for a new QR.
- Keep the instance webhook's `webhookByEvents` off: with it, Evolution adds
  the event name to the URL and an exact-path route answers 404.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [WPPConnect](/guide/wppconnect): the other self-hosted gateway, sharing `@botmesh/wa-gateway-kit`.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/evolution-provider)
