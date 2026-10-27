# Twilio

Twilio Programmable Messaging: **WhatsApp and SMS/MMS** with one class.
Webhooks verified with `X-Twilio-Signature`, which covers the exact public
URL.

## Install

```bash
pnpm add @botmesh/core @botmesh/twilio
```

## Usage

```ts
import { TwilioProvider } from '@botmesh/twilio'

const provider = new TwilioProvider({
  accountSid: process.env.TWILIO_SID!,
  authToken: process.env.TWILIO_TOKEN!,           // signs webhooks + REST auth
  whatsappFrom: 'whatsapp:+14155238886',
  smsFrom: '+15017122661',
  webhookUrl: 'https://bot.example.com/twilio/webhook', // EXACT URL set in Twilio
})
```

- `chatId` is Twilio's `From` as is (`whatsapp:+57…` or `+57…`): the same
  person on WhatsApp and SMS is two chats.
- Text up to 1600 characters; media only from public URLs; buttons and
  lists become numbered text; `template` maps to `ContentSid` +
  `ContentVariables`.
- `ingestRequest({ url, body, headers })` for per-request URLs
  (multi-tenant). With `webhookPath` (URL rebuilt from the `Host` /
  `X-Forwarded-*` headers), pass the request's path and query as the third
  argument of `ingest()` (`@botmesh/server` does): a query string Twilio
  called with is then part of the signed URL.
- Error 63016 maps to `OutsideSessionWindowError`.
- A message with several attachments (`NumMedia` > 1, up to 10) arrives as
  **one message per attachment**, in order: the first keeps the `MessageSid`
  and the text (`Body`); attachment `i` gets the id `MessageSid:i` and an
  empty body (unique ids, stable across webhook retries).

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [24-hour window and pricing](/guide/session-window): templates outside the WhatsApp window.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/twilio-provider)
