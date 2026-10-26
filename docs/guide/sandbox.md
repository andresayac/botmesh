# Platform sandbox

`@botmesh/sandbox` simulates the messaging platforms on your machine, so you can test a bot on
every channel end to end without registering an app, a phone number or a public webhook.

The [terminal simulator](./dev-simulator.md) replaces the provider with an in-memory one. The
sandbox does the opposite: it keeps the **real provider** and replaces the **platform**. Your
bot talks over real HTTP to a local server that answers like WhatsApp, Telegram or Twilio. That
server delivers webhooks signed with a secret it chooses, so signature checks, error mapping,
media downloads and retries all run the production code path.

::: info Not on npm yet
`@botmesh/sandbox` lives in the monorepo and is not published to npm. Use it from a clone:
`pnpm install && pnpm build`.
:::

Pick the tool by what you want to check:

| You want to | Use |
| --- | --- |
| Unit-test flows and handlers, fast and in memory | [`createTestBot` and `MockProvider`](/guide/testing) |
| Chat with your bot in the terminal while you write it | the [terminal simulator](/guide/dev-simulator) |
| Run a channel's real provider end to end: signatures, request shapes, platform errors, media, retries | this sandbox |
| Pair a real WhatsApp number | a test phone (see [What stays manual](#what-stays-manual)) |

Baileys has no simulator here: WhatsApp Web is a binary socket protocol, not a documented
HTTP API. Test Baileys bots with `MockProvider` and the terminal simulator, and pair a test
number for the last check.

## Channels

| Channel | Provider | Inbound | Webhook authentication |
| --- | --- | --- | --- |
| WhatsApp Cloud API | `@botmesh/meta` | webhook + GET handshake | `X-Hub-Signature-256` |
| Messenger | `@botmesh/messenger` | webhook | `X-Hub-Signature-256` |
| Instagram DM | `@botmesh/instagram` | webhook | `X-Hub-Signature-256` |
| Twilio (WhatsApp, SMS) | `@botmesh/twilio` | form webhook + status callbacks | `X-Twilio-Signature` |
| Gupshup | `@botmesh/gupshup` | v2 callbacks | shared token |
| HighLevel | `@botmesh/gohighlevel` | `InboundMessage` | `X-GHL-Signature` (Ed25519) |
| TikTok | `@botmesh/tiktok` | DMs and comments | `TikTok-Signature` |
| Discord | `@botmesh/discord` | Gateway v10 WebSocket | bot token |
| Telegram | `@botmesh/telegram` | `getUpdates` or webhook | `X-Telegram-Bot-Api-Secret-Token` |

Every simulator is a small `node:http` server (Discord adds a WebSocket gateway on the same
port). Every provider points at it through the base-URL option it already has: `graphUrl` (Meta,
Messenger, Instagram), `apiUrl` and `gatewayUrl` (Discord), `baseUrl` (Telegram, Gupshup,
HighLevel), `apiBaseUrl` (Twilio, TikTok). `sim.providerConfig()` returns that configuration,
including the media-download options that allow `http://127.0.0.1`.

## The web chat

```bash
pnpm build
pnpm sandbox
# → open http://127.0.0.1:4610
```

The command starts the nine simulators, one bot per channel and a web page (one static HTML
file, no build step). Pick a channel in the sidebar and write as a user. You can send files
(📎), share a location (📍), tap buttons and list rows, and answer polls. You see the bot's
answers as the platform would render them, including delivery and read ticks.

The inspector on the right has three tabs:

- **API requests**: every call the provider made, with its status and any difference from the
  documented request shape.
- **Webhooks**: every delivery to the bot, with its HTTP status and retry attempt.
- **Faults & user**: make the next send fail with a platform error (rate limit, invalid
  recipient, outside the 24 h window, media too large, authentication, server error). Here you
  can also change the simulated user's id and name.

Options:

```bash
pnpm --filter @botmesh/sandbox start -- --help
pnpm --filter @botmesh/sandbox start -- --channels whatsapp,telegram --port 4620
pnpm --filter @botmesh/sandbox start -- --bot bakery      # examples/bakery-ai with a scripted model
pnpm --filter @botmesh/sandbox start -- --telegram webhook --no-status
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--port <n>` | `4610` | Port of the web chat (`0` picks a free one). |
| `--host <addr>` | `127.0.0.1` | Bind address of the web chat and its API (see below). |
| `--allow-host <list>` | | Extra host names accepted in `Host`/`Origin`, comma-separated. |
| `--token <value>` | random per run | Fixed API token (printed at start). |
| `--channels <list>` | all | `whatsapp`, `messenger`, `instagram`, `telegram`, `discord`, `twilio`, `gupshup`, `gohighlevel`, `tiktok`. |
| `--bot <name>` | `demo` | `demo`, `bakery` (the bakery example with a scripted model) or `none`. |
| `--telegram <mode>` | `polling` | `polling` or `webhook`. |
| `--no-status` | | Do not send delivered/read receipts automatically. |
| `--log <level>` | `warn` | Log level of the providers and bots. |

### Local-only API

The page talks to the hub through a small JSON API. Any web page you open in the same browser
could also reach `127.0.0.1`, so the API protects itself:

- It binds to `127.0.0.1` by default. `--host` changes that, and the CLI warns when the
  address is not loopback. `--host` only moves the hub: the simulators always stay on
  `127.0.0.1`, because like the provider APIs they imitate they check neither `Host` nor a
  token.
- Every request must carry a loopback `Host` header on the hub's port (`127.0.0.1`,
  `localhost` or `[::1]`, plus the names in `--allow-host`/`allowedHosts`). That defeats
  DNS rebinding, where a hostile domain is re-pointed at 127.0.0.1. When the browser sends an
  `Origin` or `Sec-Fetch-Site` header, it must be the hub's own origin.
- State-changing calls (`POST /api/<channel>/send|fault|status|reset`) also need the per-run
  token in the `x-sandbox-token` header. The CLI prints the token at start and the hub embeds
  it in the page it serves. `--token` (or `startSandbox({ token })`) fixes it for scripts, and
  `sandbox.token` returns it from code.
- Bodies are bounded (32 MiB for `send`, 64 KiB otherwise). Malformed JSON, unknown fields,
  wrong types and unknown channels get a 4xx with `{ "error": "..." }` that names the problem,
  and a simulator that cannot express an input (a location on Discord) answers 422.
- Media uploaded through the page is served with `nosniff`, a `sandbox` CSP and, except
  for plain images, audio and video, as a download.

Poll buttons send a native vote on channels whose provider turns one into a `'poll'` event
(`POLL_VOTE_PARSING` in `@botmesh/sandbox/providers`). Everywhere else they send the
option text. The Telegram and Discord simulators can deliver native votes (`poll_answer`,
`MESSAGE_POLL_VOTE_ADD`); today only the Telegram provider parses them, so Telegram gets a
native vote and Discord the option text. A test fails as soon as a provider and the set
disagree, so the set is updated together with the provider.

The **demo bot** (`--bot demo`, the default) answers `hi` (or `hola`), `menu`, `ubicacion`
(a location) and `encuesta` (a poll), echoes media and locations, and sends anything else to `aiPlugin` with a scripted
`MockAIProvider` (no API key). `--bot bakery` runs the [bakery example](https://github.com/andresayac/botmesh/tree/main/examples/bakery-ai)
through the same channels.

To run your own bot, use `startSandbox()` from code:

```ts
import { startSandbox } from '@botmesh/sandbox'

const sandbox = await startSandbox({
  bot: 'none',
  setup: (bot, channel) => {
    bot.when('hola', (ctx) => ctx.reply(`Hi from ${channel}`))
  },
})
console.log(sandbox.url)
```

## In tests

`startHarness()` starts the simulator, the bot's webhook ingress (`@botmesh/server`) and a `Bot`
on the real provider:

```ts
import { CloudAPIProvider } from '@botmesh/meta'
import { RateLimitedError } from '@botmesh/core'
import { WhatsAppSimulator, startHarness } from '@botmesh/sandbox'

const h = await startHarness(
  new WhatsAppSimulator(),
  (sim) => new CloudAPIProvider(sim.providerConfig()),
  (bot) => {
    bot.when('menu', (ctx) => ctx.buttons('Pick one', [{ id: 'bread', title: 'Bread' }]))
    bot.when('bread', (ctx) => ctx.reply('Good choice'))
  },
)

await h.sim.sendText('menu')                                   // signed webhook → bot
const menu = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
await h.sim.send({ reply: { kind: 'button', id: 'bread', messageId: menu.id } })
await h.sim.waitForOutbound((r) => r.text === 'Good choice')
expect(h.sim.issues()).toEqual([])                             // every request matched the docs

h.sim.fail('rateLimit', { retryAfterSec: 30 })                 // next send: 429 + Retry-After
await h.stop()
```

What a simulated user can do (`sim.send(input)`): `text`, `media` (`{ kind, data, mimetype,
filename, caption }`), `location`, `reply` (button or list row), `edit` (Telegram, Messenger),
`pollVote` (Telegram, Discord) and `quotedId`. Each outbound message the provider sends is normalized
into an `OutboundRecord` (`kind`, `text`, `buttons`, `sections`, `media`, `location`,
`template`, `poll`, `action`) and keeps the raw request.

### Spec checks

Each simulator validates the requests it receives against the platform's documented request
shape: required fields, enums, lengths and counts. Examples are 4096-character WhatsApp text, 3
reply buttons with 20-character titles, 10 list rows, Twilio's `To` plus `From` or
`MessagingServiceSid` plus a body, Discord's 2000-character content and 5 action rows, and
Telegram's 64-byte `callback_data`. The schemas are written in a JSON Schema subset.

Twilio and Discord publish official OpenAPI documents under the MIT License, so their
simulators also validate every create-message request (and Discord's edits and webhook
followups) against fragments of [twilio-oai](https://github.com/twilio/twilio-oai) and
[discord-api-spec](https://github.com/discord/discord-api-spec). Those issues are tagged
`[openapi]`. The fragments are vendored in `packages/sandbox/src/specs/` with their licenses
and commits, so tests never touch the network. `scripts/vendor-openapi.mjs` regenerates them
from downloaded copies. Meta, Gupshup, HighLevel, TikTok and Telegram publish no official
machine-readable spec, so their schemas stay hand-written from the docs.

In strict mode, the default, an invalid request gets the platform's own validation error. With
`strict: false` it succeeds and is only listed in `sim.issues()`.

### Scenarios

| Helper | Simulates |
| --- | --- |
| `duplicate(sim, input, n)` | the same event delivered `n` times (a platform retry after a lost 200) |
| `outOfOrder(sim, inputs)` | events built in order and delivered newest first |
| `burst(sim, inputs)` | concurrent events from one or many users |
| `expiredMedia(sim, input)` | a media URL that has expired when the bot downloads it |
| `statusSequence(sim, id)` | sent → delivered → read for one bot message |

Simulator options cover the rest:

- `webhookRetries` / `webhookRetryDelayMs`: redeliver when the bot answers non-2xx.
- `mediaTtlMs`: inbound media URLs expire.
- `autoStatus: 'read'`: receipts after each bot message.
- `strict`: answer invalid requests with the platform's validation error (default `true`).

### Errors

`sim.fail(kind, { times, match, retryAfterSec })` answers in the platform's own format. The
provider must then reject with the typed `ProviderError` subclass:

| Fault | WhatsApp | Twilio | Telegram | Discord | Typed error |
| --- | --- | --- | --- | --- | --- |
| `rateLimit` | 429, code 130429 | 429, code 20429 | 429, `retry_after` | 429, `retry_after` | `RateLimitedError` |
| `invalidRecipient` | code 131026 | code 21211 | 400 chat not found | 50007 | `RecipientUnreachableError` |
| `outsideWindow` | code 131047 | code 63016 | 403 bot blocked¹ | 50001 Missing Access¹ | `OutsideSessionWindowError` |
| `mediaTooLarge` | 413, code 131053 | code 11751 | 413 | 413, code 40005 | `PayloadTooLargeError` |
| `auth` | 401, code 190 | 401, code 20003 | 401 | 401 | `ProviderError` |

¹ Telegram and Discord have no messaging window: their closest platform answer maps to
`RecipientUnreachableError`.

A `ctx.reply` that gets a short `Retry-After` (5 s at most) is retried in place by the core, so
the end-to-end suites use `retryAfterSec: 30` to see the error.

::: tip Discord and Telegram interactions
On Discord (`interactionsRequireAck`) the core acknowledges every interaction on its own: a
deferred ack (`interaction_callback:6`) before the handler's first reply, shortly before the 3 s
deadline or when the handler ends, unless the handler called `ctx.acknowledge(text)` first
(`interaction_callback:4`). On Telegram the ack is optional, so without `ctx.acknowledge()` the
button keeps its loading spinner. The sandbox records each acknowledgement as an `action` record.
:::

## Self-hosted platforms in Docker

Some platforms can run locally: Evolution API, WPPConnect Server, Chatwoot and Mailpit. Their
opt-in suites live in `packages/sandbox/tests/docker/` and are skipped unless the variables are
set:

```bash
docker compose -f packages/sandbox/docker/compose.yml up -d
docker compose -f packages/sandbox/docker/compose.yml run --rm chatwoot-init   # first time
node packages/sandbox/docker/chatwoot-token.mjs                                # prints the Chatwoot variables

BOTWA_TEST_EVOLUTION_URL=http://127.0.0.1:47811 BOTWA_TEST_EVOLUTION_KEY=sandbox-evolution-key \
BOTWA_TEST_WPPCONNECT_URL=http://127.0.0.1:47812 BOTWA_TEST_WPPCONNECT_SECRET=sandbox-wppconnect-secret \
BOTWA_TEST_MAILPIT_URL=http://127.0.0.1:47814 \
BOTWA_TEST_CHATWOOT_URL=… BOTWA_TEST_CHATWOOT_TOKEN=… BOTWA_TEST_CHATWOOT_ACCOUNT_ID=… \
  pnpm --filter @botmesh/sandbox exec vitest run tests/docker
```

| Suite | Covers |
| --- | --- |
| Evolution API | health; instance creation with a webhook that sends the shared secret; the QR and connection webhooks reach the bot through `@botmesh/server` and are accepted; `start()` reports the QR; a second instance whose webhook uses `jwt_key` reaches a provider with `webhookJwtKey`; typed errors for an unpaired instance, an instance without a WhatsApp session ("not connected"), an unknown instance and a wrong API key; forged webhooks get 401 |
| WPPConnect Server | token from the secret key; session start with the webhook token in the URL query; the QR reaches the bot; typed errors for an unpaired session and a wrong secret |
| Chatwoot | full round trip with `@botmesh/chatwoot`: user and bot messages appear in a conversation; an agent reply posted through Chatwoot's API comes back through Chatwoot's own webhook, reaches the user and hands the chat off; resolving the conversation resumes the bot |
| Mailpit | `@botmesh/email` SMTP sends checked through Mailpit's API (identity, `Auto-Submitted`, attachments). Inbound IMAP is covered by the GreenMail suite of `@botmesh/email` |

The containers reach the test's webhook server through `host.docker.internal`. Set
`BOTWA_TEST_DOCKER_HOST` if your Docker uses another name. All ports are published on
`127.0.0.1` only. WPPConnect Server is pinned to `1.3.50`: `1.3.55` (`latest` in October 2026)
drops the QR of a session started through the REST API, and it calls only allow-listed webhook
URLs (`WEBHOOK_ALLOWED_URLS`).

### What stays manual

Pairing a real WhatsApp number (scanning the QR for Evolution or WPPConnect, or the Baileys
pairing code) needs a phone, so it stays manual:

1. Start the stack and run `start()` on the provider (or create the instance from the
   Evolution manager at `http://127.0.0.1:47811/manager`).
2. Scan the QR from **WhatsApp → Linked devices** on a test phone.
3. Re-run the suites. Once the instance is `open`, sending works too. The suites only need
   the instance to exist.

Never point the Docker suites at a production Chatwoot or a paired production number: they
create inboxes, webhooks and instances, and remove them at the end.
