# Getting Started

Go from nothing to a bot that answers you in about five minutes. Try it in
your terminal first (no phone, no account), then connect it to WhatsApp or
Telegram without changing the bot code.

## Requirements

- **Node.js 22.12 or newer** ([download](https://nodejs.org/)). Check with `node -v`.
- **npm** (bundled with Node) or **pnpm**. The commands below use npm; with
  pnpm, write `pnpm add`, `pnpm create` and `pnpm exec`.
- To connect for real: a phone with WhatsApp (its number becomes the bot) or a
  Telegram bot token from [@BotFather](https://t.me/BotFather). The terminal
  simulator needs neither.

::: warning Prerelease: add the tag until the stable version ships
botmesh is in prerelease. Until `@botmesh/core` 2.0.0 is published, add the
prerelease dist-tag to the install commands on this site:
`npm create botmesh@alpha my-bot`,
`npm install @botmesh/core@alpha @botmesh/baileys@alpha` (write `@beta` once
the beta is out). Without a tag, npm installs whatever `latest` points to,
which can be an older prerelease than the one these docs describe. Once the
stable version ships, the commands work exactly as written.
:::

## Option A: scaffold a project (recommended) {#scaffold-a-project-with-create-botmesh}

`create-botmesh` generates a project that runs both in the simulator and on
the real channel:

```bash
npm create botmesh my-bot                                # asks for a template
npm create botmesh my-bot -- --template telegram --yes   # or pick it up front
cd my-bot
npm install
npm run dev     # chat with the bot in the terminal (no phone, no credentials)
```

Type `hola`, then `menu`, then `/help`. When you are happy with it, connect
the real channel:

| Template | Before `npm start` |
| --- | --- |
| `baileys` (default) | Nothing. A QR code appears in the terminal: scan it as in [Link WhatsApp](#link-whatsapp). |
| `telegram` | Copy `.env.example` to `.env` and paste your `TELEGRAM_TOKEN`. |
| `meta` | Fill in the four `META_*` variables in `.env` and expose a public webhook URL ([Webhook server](./server)). |
| `ai`, `ai-full` | Put `ANTHROPIC_API_KEY` in `.env`, then scan the QR. |

```bash
npm start
```

If `.env` lacks a variable the project needs, `npm start` stops with one line
naming it (`Missing TELEGRAM_TOKEN: copy .env.example to .env ...`) before
connecting anything.

The templates are written in Spanish and set `lang: 'es'`. The full list of
templates, the CLI flags and the generated files are in
[Project templates](#project-templates).

## Option B: set it up by hand

### 1. Install

```bash
mkdir my-bot && cd my-bot
npm init -y
npm pkg set type=module        # botmesh is ESM-only
npm install @botmesh/core @botmesh/baileys
```

For Telegram, install `@botmesh/telegram` instead of `@botmesh/baileys`.
botmesh ships only ES modules, so the project needs `"type": "module"` (or
`.mjs` files) and you load the packages with `import`.

### 2. Write the bot

Create `bot.js`. The bot is a **factory** (`defineBot`): it receives a
provider and returns the configured `Bot`. The same file then runs in the
simulator and on the real channel:

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // Built-in commands: /start /help /reset /cancel /id /ping
  bot.plug(slashCommandsPlugin)

  bot.when('hi', (ctx) => ctx.reply('👋 Hello! Send "signup" to try a flow.'))

  bot.use(
    flow('signup')
      .ask('What is your name?', 'name')
      .say((_ctx, c) => `Nice to meet you, ${c.state.name}!`),
  )

  // Runs only when nothing above handled the message
  bot.onMessage((ctx) => ctx.reply('Send "hi", "signup" or /help.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `botmesh dev` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'my-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "hi" from another phone.'))
  await bot.start()
}
```

### 3. Try it in the terminal

```bash
npx botmesh dev bot.js      # pnpm: pnpm exec botmesh dev bot.js
```

```text
user › hi
bot › 👋 Hello! Send "signup" to try a flow.
user › signup
bot › What is your name?
user › Ana
bot › Nice to meet you, Ana!
```

The simulator injects an in-memory provider, so nothing leaves your machine,
and it reloads the bot when you save the file. `:help` lists its commands and
`:quit` exits. More in [Terminal simulator](./dev-simulator).

### 4. Connect a real channel

#### Link WhatsApp

```bash
node bot.js
```

A QR code appears in the terminal. On the phone whose number **will be the
bot**:

1. Open **WhatsApp** → **Settings** → **Linked devices**.
2. Tap **Link a device** and scan the QR.

When `✅ Connected` prints, send `hi` to that number **from another phone**.
The login is saved in `./sessions/my-bot/`, so the next start reconnects
without a QR. Keep that folder private and out of git: whoever has it controls
the account.

::: tip No camera at hand?
Link with a code instead: pass the bot's number to the provider and print the
code it receives.

```js
const bot = await createBot(new BaileysProvider({ session: 'my-bot', pairingPhoneNumber: '+57 300 123 4567' }))
bot.on('qr', (code) => console.log('Pairing code:', code))
```

Then in WhatsApp: **Linked devices** → **Link a device** → **Link with phone
number instead**, and type the code.
:::

#### Or connect Telegram

Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy
its token. In `bot.js`, import the Telegram provider and use it in the start
block:

```js
import { TelegramProvider } from '@botmesh/telegram'

// replaces the BaileysProvider line inside `if (isMainModule(import.meta))`
const bot = await createBot(new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' }))
```

```bash
echo TELEGRAM_TOKEN=123456:ABC-your-token > .env
node --env-file=.env bot.js
```

Open your bot in Telegram and send `hi`. The provider uses long polling by
default, so no public URL is needed.

#### Other channels

Only the provider changes: handlers, flows, hooks and plugins are the same on
every transport.

| Transport | Package | Status | Notes |
| --- | --- | --- | --- |
| WhatsApp (Baileys 7) | `@botmesh/baileys` | Published | Unofficial WhatsApp Web protocol, QR or pairing code |
| WhatsApp Cloud API | `@botmesh/meta` | Published | Official Meta API, webhook, native buttons and templates |
| Telegram | `@botmesh/telegram` | Published | Bot API, long polling or webhook |
| Messenger, Instagram, Discord, and more | `@botmesh/messenger`, … | Experimental | Not on npm yet; see [Channels](./channels) |

The official WhatsApp Cloud API, for example:

```js
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN ?? '',
  phoneNumberId: process.env.META_PHONE_ID ?? '',
  verifyToken: process.env.META_VERIFY_TOKEN ?? '',
  appSecret: process.env.META_APP_SECRET, // required: verifies X-Hub-Signature-256
})
```

It is webhook-based: your HTTP server passes the **raw** body of each POST to
`provider.ingest(rawBody, headers)`. See [Webhook server](./server) to mount it
and [Channels](./channels) for what each transport supports.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `SyntaxError: Cannot use import statement outside a module`, or `ERR_REQUIRE_ESM` | Add `"type": "module"` to `package.json` (`npm pkg set type=module`) or rename the file to `.mjs`. |
| `botmesh dev` stops with *the entry ran but exports no bot factory* | Default-export `defineBot((provider) => ...)` and start the real provider only inside `if (isMainModule(import.meta))`, as in step 2. |
| The bot ignores `hi there` or `/hi` | A text trigger matches the **whole** message, normalized (case, accents and extra spaces ignored). For substring matching use `{ pattern: 'hi', match: 'contains' }`; see [Special triggers](./triggers). |
| WhatsApp shows a new QR on every start | The session was deleted, or WhatsApp unlinked the device (the provider then deletes `sessions/<session>` itself). Scan again. |
| WhatsApp disconnects with `440` (`connectionReplaced`) | Another process uses the same session. Stop it: the provider does not reconnect and fight for the session. |
| Telegram logs `getUpdates conflicts with an active webhook` | The token has a webhook set. Call `deleteWebhook`, or run in webhook mode (`polling: false`). |
| Telegram fails with `Unauthorized — check the bot token` | The token is wrong or was revoked: copy it again from @BotFather. |
| `BotNotRunningError` when sending | `bot.send()` and `ctx.reply()` need a running bot: send after `await bot.start()` (or from a `'ready'` listener). |
| The built-in texts (`/help`, timeouts) are in English | That is the default. `new Bot({ provider, lang: 'es' })` switches them to Spanish; see [Internationalization](./i18n). |

## Project templates

| Template | What you get |
| --- | --- |
| `baileys` (default) | WhatsApp via Baileys: scan a QR to link |
| `meta` | WhatsApp Cloud API (webhook; needs Meta credentials and a public URL) |
| `telegram` | Telegram Bot API (long polling; needs a @BotFather token) |
| `ai` | Baileys + `@botmesh/ai` business-scoped support autoresponder (`ANTHROPIC_API_KEY`) |
| `games` | Guess the number, hangman, trivia, tic-tac-toe, rock-paper-scissors; scores in `ctx.user` |
| `support` | Tickets per user, FAQ menu and human handoff |
| `store` | Catalog, per-user cart with a 7-day TTL and a checkout flow |
| `restaurant` | Menu, delivery/pickup orders, "repeat my last order", table reservations |
| `clinic` | Appointment booking (specialty, day, time), list/cancel appointments |
| `ai-full` | Business-scoped AI + keyword/regex intents + SQLite store + scheduler + slash commands + handoff (`ANTHROPIC_API_KEY`) |

The use-case templates (`games` to `ai-full`) run on Baileys. The transport
templates (`baileys`, `meta`, `telegram`, `ai`) install the built-in slash
commands, so `/reset` or `/cancel` escapes their sample `menu` flow.

| Flag | Meaning |
| --- | --- |
| `-t, --template <name>` | One of the templates above (`baileys` when non-interactive) |
| `--name <name>` | Package name (default: derived from the directory) |
| `-y, --yes` | Skip prompts and use defaults |
| `--overwrite` | Allow scaffolding into a non-empty directory |
| `--force` | Allow a directory inside the botmesh monorepo itself (refused by default) |
| `-h, --help` | Show help |

Every project contains `package.json` (with `npm start` and `npm run dev`),
`src/bot.js`, `.env.example`, `.gitignore`, a `README.md` and an
**`AGENTS.md`** that tells AI coding agents which API to use and which
commands to run.

## Next steps

- [Your first bot](./first-bot): commands, media, a validated flow and a catch-all
- [Core concepts](./concepts): how a message is routed, `ctx`, triggers and ids
- [Channels](./channels): every transport and what it supports
- [Testing](./testing): test your flows with `createTestBot`, no network
- [Examples](/examples/messages): copy-ready recipes
