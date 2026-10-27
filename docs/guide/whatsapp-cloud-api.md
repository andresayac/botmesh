# WhatsApp Cloud API

The official API. Webhook-based: GET handshake with `verifyChallenge()`,
POST events with `ingest()` (see the server example
in the [channels overview](/guide/channels#socket-polling-or-webhook)).

## Install

```bash
pnpm add @botmesh/core @botmesh/meta
```

## Usage

Setup in Meta: create an app with the **WhatsApp** product on
developers.facebook.com, generate a permanent **system-user token** with
`whatsapp_business_messaging`, copy the sender's **phone number id**, then set
the webhook URL and a verify token of your choice under WhatsApp →
Configuration and subscribe it to the **`messages`** field (it carries both
messages and delivery statuses).

```ts
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,        // system-user token
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!, // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,     // verifies X-Hub-Signature-256
})
```

- Native reply buttons (max 3: more rejects with `UnsupportedContentError`,
  send a list instead), lists, templates and WhatsApp Flows forms. A button
  with `url` goes out as a `cta_url` link button (one per message: several
  links, or a link mixed with reply buttons, reject). A `card` keeps its
  image (as the media or the interactive header) and its buttons. Graph's
  limits are checked before sending: no buttons, repeated button ids or
  titles (compared after the 20-character cut), a list with no rows, more
  than 10 rows in total or repeated row ids reject with
  `UnsupportedContentError`. Labels are cut on grapheme boundaries, so an
  emoji is kept whole or dropped, never split.
- A missing `accessToken`, `phoneNumberId` or `verifyToken` fails at
  construction with an error naming the field (`phoneNumberId` may also be
  a safe integer). Every Graph request has a timeout (`requestTimeoutMs`,
  60 s by default); media uploads have their own (`uploadTimeoutMs`, 5 min
  by default).
- An interactive reply that is not a button or list press (for example
  `call_permission_reply`) arrives as an `unknown` message with the raw
  payload in `ctx.ref.native`.
- **Graph API version:** `apiVersion` defaults to `DEFAULT_GRAPH_API_VERSION`
  from `@botmesh/graph-core` (`v26.0`, released 2026-07-29; Messenger and
  Instagram use the same default). Meta retires each version about two years
  after its release, so the default follows the current one and moves in a
  minor release, after the payloads are checked against Meta's changelog. Pin
  `apiVersion` (for example `'v24.0'`) to stay on a version until you
  migrate. A `played` status (a voice note was listened to) is reported as
  `read` with `platformData.played: true`.
- Users with a WhatsApp username may arrive with a BSUID instead of a phone
  number; the provider keeps one stable id per person (`identityMap`).
- Outside the 24 h window free-form sends reject with
  `OutsideSessionWindowError`. The optional `sessionWindow` manager reopens
  the chat with a template and retries: see
  [24-hour window and pricing](/guide/session-window).
- No groups, typing or polls in the API, and no delete for everyone: the
  provider has no `typing()` or `deleteMessage()`, so `ctx.typing()` and
  `ctx.delete()` do nothing (see the [cross-channel contract](/guide/channels#cross-channel-contract)).
- Text over 4096 characters is split into several messages by the core.
- While the bot is stopped, `ingest()` answers `503`, so Meta redelivers the
  webhook after the restart.
- `publishForm()` bakes the default submit label of a form into the Flow in
  the provider's `lang` (default `'en'`; set it to your bot's `BotConfig.lang`),
  or in `publishForm(def, { lang })` for one Flow. A form's own `submitLabel`
  always wins.

## Next steps

- [Channels](/guide/channels): choosing a channel, the capability matrix and the cross-channel contract.
- [24-hour window and pricing](/guide/session-window): reopen a chat with a template and track usage.
- [Forms](/guide/forms): native WhatsApp Flows.
- [Webhook server](/guide/server): mount the provider with `@botmesh/server`.
- [Package README](https://github.com/andresayac/botmesh/tree/main/packages/meta-provider)
