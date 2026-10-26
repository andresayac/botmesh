# @botmesh/sandbox

> Private package of the botmesh monorepo. It is not published to npm.

Local simulators of the messaging platforms, so every channel can be tested end to end
without registering an app, a phone number or a webhook anywhere.

Each simulator is a small `node:http` server (no framework). It implements the REST endpoints
the provider calls, with realistic answers and realistic errors. It also delivers webhooks to
your bot exactly as the platform does, signed with a secret the simulator chooses, so the
signatures are real.

| Channel | Simulator | Provider | Inbound | Webhook auth |
| --- | --- | --- | --- | --- |
| WhatsApp Cloud API | `WhatsAppSimulator` | `@botmesh/meta` | webhook | `X-Hub-Signature-256` + GET handshake |
| Messenger | `MessengerSimulator` | `@botmesh/messenger` | webhook | `X-Hub-Signature-256` |
| Instagram DM | `InstagramSimulator` | `@botmesh/instagram` | webhook | `X-Hub-Signature-256` |
| Twilio (WhatsApp, SMS) | `TwilioSimulator` | `@botmesh/twilio` | form webhook + status callbacks | `X-Twilio-Signature` |
| Gupshup | `GupshupSimulator` | `@botmesh/gupshup` | v2 callbacks | shared token |
| HighLevel | `GoHighLevelSimulator` | `@botmesh/gohighlevel` | `InboundMessage` | `X-GHL-Signature` (Ed25519) |
| TikTok | `TikTokSimulator` | `@botmesh/tiktok` | DMs + comments | `TikTok-Signature` |
| Discord | `DiscordSimulator` | `@botmesh/discord` | Gateway v10 WebSocket | bot token |
| Telegram | `TelegramSimulator` | `@botmesh/telegram` | `getUpdates` or webhook | `X-Telegram-Bot-Api-Secret-Token` |

## Web chat UI

```bash
pnpm build
pnpm sandbox                                    # every channel, demo bot, http://127.0.0.1:4610
pnpm --filter @botmesh/sandbox start -- --bot bakery --channels whatsapp,telegram
```

Pick a channel, write as a user, send files, locations and button or list replies, and watch
the bot answer. The inspector shows every API request (with spec violations), every webhook
delivery, and lets you inject platform errors.

## In tests

```ts
import { WhatsAppSimulator, startHarness } from '@botmesh/sandbox'
import { CloudAPIProvider } from '@botmesh/meta'

const h = await startHarness(
  new WhatsAppSimulator(),
  (sim) => new CloudAPIProvider(sim.providerConfig()),
  (bot) => { bot.when('hola', (ctx) => ctx.reply('¡Hola!')) },
)
await h.sim.sendText('hola')
expect((await h.sim.waitForOutbound()).text).toBe('¡Hola!')
expect(h.sim.issues()).toEqual([])          // every request matched the documented shape
h.sim.fail('rateLimit', { retryAfterSec: 30 }) // next send answers 429 + Retry-After
await h.stop()
```

Scenario helpers: `duplicate`, `outOfOrder`, `burst`, `expiredMedia` and `statusSequence`.

## Self-hosted platforms (Docker)

`docker/compose.yml` starts Evolution API, WPPConnect Server, Chatwoot and Mailpit for the
opt-in suites in `tests/docker/*.integration.test.ts` (variables `BOTWA_TEST_EVOLUTION_*`,
`BOTWA_TEST_WPPCONNECT_*`, `BOTWA_TEST_CHATWOOT_*`, `BOTWA_TEST_MAILPIT_*`). Pairing a WhatsApp
number by QR code stays manual.

See the guide: `docs/guide/sandbox.md`.
