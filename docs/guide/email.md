# Email

Email: **IMAP IDLE** to receive and **SMTP** to reply. Each email thread is
a chat, so `ask()` flows continue when the customer replies to the email.
`imapflow` and `nodemailer` are optional peer dependencies loaded lazily.

## Install

```bash
pnpm add @botmesh/core @botmesh/email
```

## Usage

```ts
import { EmailProvider } from '@botmesh/email'

const provider = new EmailProvider({
  address: 'support@acme.com',
  imap: { host: 'imap.example.com', user: 'support@acme.com', pass: process.env.IMAP_PASS! },
  smtp: { host: 'smtp.example.com', user: 'support@acme.com', pass: process.env.SMTP_PASS! },
})
```

- `threading: 'thread'` (default, one chat per thread) or `'sender'` (one
  chat per address); persist threads with `threadStore: cursorThreadStore(store)`.
  That store also keeps the mailbox UID cursor, so after a restart the bot
  resumes after the last message it processed and never redelivers mail
  (even with `markSeen: false`).
- Loop protection against auto-replies and mailing lists, bounce handling
  (`status: 'failed'` events, suppression of hard-bounced addresses).
- `From` is not authenticated by email itself: use
  `requireAuthentication: { authservId }` to accept only mail your MTA
  authenticated. Hostile headers are contained: addresses with control
  characters are dropped, oversized Message-IDs ignored and `References`
  chains capped.
- `secure` means implicit TLS (default except IMAP port 143, and only SMTP
  port 465); against a plain-text or STARTTLS port `start()`/`send()` reject
  with a `TLS handshake failed` message that says which option to set.
- Without IMAP, `ingest(rawMime)` accepts raw MIME from an inbound-mail
  webhook and resolves `{ status, accepted, reason? }`.
- A transport built from `smtp` is closed on `stop()` and rebuilt on the
  next send (pooled ones too); an injected `smtpTransport` is yours and
  `stop()` never closes it.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [Persistent store](/guide/store): keep threads and the mailbox cursor across restarts.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/email-provider)
