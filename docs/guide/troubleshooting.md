# Troubleshooting

The errors people hit most often, what they mean and how to fix them. Search this page for the exact message you see (most botmesh errors name the option or the package involved).

## Installing

### `ERR_PNPM_IGNORED_BUILDS` or "native module was never built"

pnpm 10 and later do not run the install scripts of dependencies until you decide which ones may run. pnpm 11 stops the install with `ERR_PNPM_IGNORED_BUILDS`; pnpm 10 installs without them, and the failure shows up later.

Decide once in `pnpm-workspace.yaml` (or run `pnpm approve-builds`) and reinstall:

```yaml
allowBuilds:
  better-sqlite3: true # native binary of @botmesh/sqlite-store: must run
  '@whiskeysockets/baileys': false # only a Node.js version check
  protobufjs: false # only a version notice
  ffmpeg-static: true # only if you installed it for Baileys voice notes
```

On pnpm 10 the equivalent is `onlyBuiltDependencies: [better-sqlite3]`. If `better-sqlite3` was skipped, `SQLiteStore` throws `better-sqlite3 is installed but its native module was never built`. npm runs every install script, so it needs none of this.

### The process aborts with `Assertion failed: (env) != nullptr`

You are on Node.js 24.19 or later with `better-sqlite3` 11 or 12. A Node.js regression ([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)) can abort the process in `RemoveEnvironmentCleanupHook` when a prepared statement is garbage-collected. Install `better-sqlite3` 13, which is built on N-API and not affected:

```bash
pnpm add better-sqlite3@^13
```

### "built for another Node.js version" / `NODE_MODULE_VERSION`

A native module (usually `better-sqlite3`) was compiled for the Node.js you had before an upgrade. Rebuild it with the Node.js that runs the bot:

```bash
pnpm rebuild better-sqlite3
```

### `ERR_REQUIRE_ESM` or `require is not defined`

botmesh is ESM-only. Use `import`, and add `"type": "module"` to your `package.json` (or use `.mjs` files). With TypeScript, set `"module": "nodenext"`.

### `pnpm add @botmesh/core` installs an older build

Right after a publish, a plain install can still get the previous beta until `latest` is moved, and a project that mixes builds can fail on missing exports or peer ranges. Check the tags with `pnpm view @botmesh/core dist-tags` and install the newest beta with the tag, for example `pnpm add @botmesh/core@beta @botmesh/baileys@beta`. See [Packages and versions](./packages#npm-dist-tags).

## WhatsApp Web (Baileys)

### The connection closes with `428` before the QR appears

WhatsApp closes connections that use an outdated handshake with `428 Connection Terminated`. Check two things:

1. `@whiskeysockets/baileys` resolves to `7.0.0-rc14` or newer in your lockfile (`pnpm why @whiskeysockets/baileys`). `@botmesh/baileys` pins a working version; an override or an old lockfile can bring back an older one.
2. You do not pass a custom `browser` tuple. Leave `browser` undefined (or use a preset such as `'macOS'`): non-standard identities can be refused with `428`.

The provider also needs to reach `wss://web.whatsapp.com` and, at startup, `raw.githubusercontent.com` (to read the current WhatsApp Web version).

### The QR never shows up

Print it in the terminal or save it as a PNG, or handle the `qr` event yourself:

```ts
const provider = new BaileysProvider({ session: 'my-bot', qr: { terminal: true, file: './qr.png' } })
bot.on('qr', (artifact) => console.log('Scan or type this:', artifact)) // a QR string or a pairing code
```

To link without a QR, pass `pairingPhoneNumber: '+57300…'` and type the code from the `qr` event in WhatsApp → Linked devices.

### The bot asks for a new QR, or stops reconnecting

The provider reports the reason on the `connection` event:

| `reason` | What happened | What to do |
| --- | --- | --- |
| `sessionInvalid` | The device was unlinked from the phone, or the session files are corrupt. The provider deletes that session's folder. | Scan the new QR. |
| `sessionTakenOver` | Another process uses the same session, or WhatsApp forbade it. The provider does **not** reconnect, to protect the number. | Stop the other instance (an old deploy, a second terminal), then start again. |
| `transient` | A network drop. The provider retries with backoff (up to 10 attempts by default). | Nothing; tune `reconnect: { maxAttempts, baseMs, capMs }` if needed. |

### The same person shows up with two ids, or a flow stops waiting for the answer

WhatsApp addresses people by phone number (**PN**, `…@s.whatsapp.net`) and by an opaque id (**LID**, `…@lid`), and the form can change between messages. `@botmesh/baileys` resolves this before the bot sees the message: `ctx.sender` and `ctx.from` use the PN whenever it is known, otherwise the LID, and the raw values are in `ctx.senderInfo.platformData` (`phoneNumber`, `lid`).

- **Never key your data on `ctx.raw`** (the raw `remoteJid`): use `ctx.sender` / `ctx.from`.
- **A person who only has a LID** (users with a WhatsApp username) keeps a stable LID id; `platformData.phoneNumber` is `undefined`. Do not assume `ctx.sender` is a phone number.
- **If the PN is learned mid-conversation**, the person switches to the PN id and a conversation started under the LID no longer receives their messages. Give flows a `.timeout()` (or `timeout` on `c.ask`) so it closes itself, and store both `platformData.phoneNumber` and `platformData.lid` if you keep per-person records.
- **Access lists match exact ids**: add the full id (`573001234567@s.whatsapp.net`, or the `@lid` id), not a bare number. Build ids with `toJid('+57 300 123 4567')`.

### Messages fail with a rate-limit error, or replies are slow

The Baileys provider queues sends in a token bucket (5 per chat every 10 s and 50 in total per minute by default) to lower the risk of a ban. A send that waits longer than `rateLimit.maxWait` (30 s) rejects with `RateLimitedError`. Spread bulk sends with `bot.broadcast()` (batches, pauses, retries) instead of a loop of `bot.send()`. See [Rate limiting](./rate-limiting).

## WhatsApp Cloud API, Messenger and Instagram

### Webhook signature mismatch (403)

Every webhook answered with `403` means the `X-Hub-Signature-256` check failed. Meta signs the exact bytes it sends, so:

- Pass the **raw body** to `provider.ingest(body, headers)`: `express.raw({ type: 'application/json' })`, the `Buffer` you collect with `node:http`, or the raw body of your framework. A body parsed by `express.json()` and re-serialized never matches (with `appSecret` set, an already-parsed object is answered with `400`).
- Use the **App Secret** of the app that owns the webhook (App settings → Basic), not the access token or the verify token.
- Do not put a proxy that rewrites the body (compression, JSON pretty-printing) in front of the endpoint.

For local tests only, `allowUnsignedWebhooks: true` turns the check off.

### Meta cannot verify the webhook URL

The `GET` handshake compares `hub.verify_token` with the provider's `verifyToken`. Answer with `provider.verifyChallenge(req.query)` and `403` when it returns `null`. The URL must be public HTTPS (use a tunnel such as `cloudflared` or `ngrok` during development).

### `OutsideSessionWindowError`

More than 24 hours passed since the user's last message, and Meta only accepts approved templates. Send a `{ kind: 'template', … }` or let the provider's `sessionWindow` reopen the conversation for you. See [WhatsApp 24h window](./session-window).

### `RecipientUnreachableError` with a test number

A test number can only write to the numbers listed under API setup → "To" in the Meta dashboard (Graph code `131030`). Add the recipient there.

### "the access token is invalid or expired" / "check the configured phone number id"

Graph code `190` is an invalid or expired access token: use a permanent system-user token with `whatsapp_business_messaging`. Code `100`/`33` means the `phoneNumberId` does not exist or the token cannot reach it: copy the **phone number id** from API setup (it is not the phone number).

### Rate limits (`130429`, `131056`, `80007`…)

They arrive as `RateLimitedError` with `retryAfterMs`. A short wait on a `ctx` send is retried once (`BotConfig.rateLimitRetry`), and `bot.broadcast()` retries per chat (`retries`, default 3). For bulk traffic, lower `concurrency` and add `delayBetween`.

## Telegram

### `409 Conflict` and the bot stops receiving updates

Two processes poll the same token (or a webhook is set while you poll). The provider stops on purpose (`sessionTakenOver`). Stop the other instance, or remove the webhook with `deleteWebhook` before using long polling.

### "check the bot token and baseUrl" (404)

The token is malformed (copy it again from @BotFather) or `baseUrl` points at a wrong path.

### Webhook answered with `401`

The `X-Telegram-Bot-Api-Secret-Token` header does not match `webhookSecret`. Pass the same value as `secret_token` to `setWebhook`.

## The bot itself

### `BotNotRunningError: bot is not running`

You sent, edited or deleted a message before `await bot.start()` or after `bot.stop()`. Schedule proactive sends from `bot.on('ready', …)` or after `start()` resolves.

### `ConfigValidationError: Invalid config.<option>`

An option of `new Bot()` has the wrong type or an invalid duration. The message names the option (`err.field`); durations take a string (`'30s'`, `'5m'`) or milliseconds.

### `Plugin "<name>" is already plugged on this bot`

Each plugin name can be plugged once. Unplug it first with the function `bot.plug()` returned, or give every instance `multiple: true` in its spec.

### `bot.when('hi')` does not match "hi there"

Text triggers compare by **normalized equality** (case, accents and extra spaces are ignored), not "contains". Use `{ pattern: 'hi', match: 'contains' }` or a `RegExp`. See [Triggers](./triggers).

### The bot does not answer in groups

Check `groupMode` (`'mentions'` and `'commands'` restrict what the bot answers in groups) and the trigger `scope`. Group conversations are per participant by default.

### The built-in texts are in English

Timeouts, retries, slash commands and form prompts default to English. Set `new Bot({ lang: 'es' })` for Spanish, or register your own texts with `bot.locale()`. See [Internationalization](./i18n).

### A `.persistent()` flow forgets where it was after a restart

The default `MemoryStore` lives in RAM. Use a durable store (`@botmesh/sqlite-store`, `@botmesh/redis-store`, or `new MemoryStore({ file })`). See [Persistent store](./store).

## Still stuck?

- Turn on debug logs: `new Bot({ provider, logger: pino({ level: 'debug' }) })`. Chat and sender ids are hashed in the bot's log lines by default (`logIds`).
- Check the [FAQ](./faq) and the package README of your channel.
- [Open an issue](https://github.com/andresayac/botmesh/issues) with the error message, the package versions (`pnpm ls @botmesh/*`) and your Node.js version. Never paste tokens or session files.
