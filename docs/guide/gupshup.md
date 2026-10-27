# Gupshup

Gupshup WhatsApp API: v1 send endpoints, v2 callbacks. Gupshup does not sign
callbacks, so they are authenticated with a shared token in the callback URL
(or a header).

## Install

```bash
pnpm add @botmesh/core @botmesh/gupshup
```

## Usage

```ts
import { GupshupProvider } from '@botmesh/gupshup'

const provider = new GupshupProvider({
  apiKey: process.env.GUPSHUP_API_KEY!,
  appName: 'MyBotApp',
  source: '917834811114',                          // the app's number
  webhookToken: process.env.GUPSHUP_WEBHOOK_TOKEN!, // callback: …/gupshup?token=<it>
})
// POST /gupshup → res.sendStatus(provider.ingestRequest({ url: req.originalUrl, body, headers }))
```

- Buttons go out as quick replies (up to 3), then as a list (up to 10),
  then as numbered text; lists are native up to 10 rows. The list button of
  degraded buttons reads `listButtonText` (default `'Options'`, max 20
  characters; `'Opciones'` for a Spanish bot). Longer labels are cut to
  WhatsApp's limits (titles 20/24 characters) instead of being rejected.
- With `@botmesh/server`, mount the provider as a route: the ingress passes
  the request URL to `ingest()`, so the `?token=` callback works as is.
- Use a URL-safe `webhookToken` (`openssl rand -hex 32`). A base64 secret
  pasted raw into `?token=` also matches (a literal `+` is not read as a
  space), and so does its percent-encoded form.
- `chatId` = the sender's phone digits (no `+`), exactly what the send API
  expects.
- Media only from public URLs. Gupshup also documents IP allow-listing: do
  both in production.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [24-hour window and pricing](/guide/session-window): templates outside the WhatsApp window.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/gupshup-provider)
