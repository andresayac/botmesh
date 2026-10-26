# create-botmesh

## 1.0.0-beta.1

### Major Changes

- 79af076: First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).

### Minor Changes

- c60603f: New `create-botmesh/internal` entry (no semver) with `TEMPLATES`, `agentsMd`, `AgentsMdInfo` and `findBotMeshMonorepo`. The main entry keeps them as deprecated re-exports until stable; use `getTemplate(name)` and `TEMPLATE_NAMES` instead of `TEMPLATES`. The CLI does not change.
- 0c0d203: The generated bots (Spanish templates) set `lang: 'es'` on `new Bot(...)`, so their built-in texts (slash commands, retries, timeouts) stay in Spanish now that `@botmesh/core` defaults to English. The generated `AGENTS.md` explains the option.

### Patch Changes

- 5dd2075: - The generated `src/bot.js` of the `ai-full`, `clinic`, `restaurant`, `store` and `support` templates type-check cleanly with `checkJs` (JSDoc types for the profile data read with `ctx.user.get()`, and an optional `store` parameter on the `ai-full` factory), so an editor no longer shows false errors in a fresh project. A test runs `checkJs` over every template.
  - "Next steps" prints `copy .env.example .env` on Windows (`cmd.exe` has no `cp`), and the generated README shows both forms.
  - The CLI warns up front when Node.js is older than 22.12, which the generated project needs (its scripts use `--env-file-if-exists`), instead of letting `npm start` fail later with Node's own `bad option` error.
- dbf6b59: The `baileys`, `meta`, `telegram` and `ai` templates install `slashCommandsPlugin` (before `aiPlugin` in `ai`). Before, `/reset` or `/cancel` typed at the `menu` flow's question was taken as the answer (the bot replied `🏓 ¡pong!`), `/help` got no reply, and in the `ai` template every command went to the LLM.
- ee49c56: The generated `bot.js` registers its menu flow with `bot.use(flow)` instead of the deprecated `bot.useFlow(flow)`.
- 5ad624e: The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
- 10c0177: `npm start` in a project generated from the `meta`, `telegram`, `ai` or `ai-full` template checks the variables it cannot run without and, when `.env` is missing or incomplete, stops with one line naming them (`Missing TELEGRAM_TOKEN: copy .env.example to .env ...`) before building any provider. The AI templates also warn at boot under `npm run dev` when `ANTHROPIC_API_KEY` is unset. Package names derived from a directory keep accented letters as their base letter (`Mi Bót` → `mi-bot`, was `mi-b-t`).
- a2c946a: The `ai-full` template stamps the same `better-sqlite3` range as the `@botmesh/sqlite-store` peer (`^11.7.0 || ^12.0.0 || ^13.0.0`), so a fresh project on Node 24 installs a major with prebuilt binaries instead of compiling 11.x from source.
- a2c946a: Scaffolded projects no longer crash before reading a single line of code: `start` and `dev` use `--env-file-if-exists`, so a fresh clone with only `.env.example` boots with the defaults instead of failing with `node: .env: not found`. Generated `engines.node` is `>=22.12` (the flag shipped in Node 22.9).

## 0.2.0-alpha.0

### Minor Changes

- 8b5ee35: The `ai-full` template adds a `cotizar_pedido` tool (prices, subtotals and total computed in code) and tells the model to use it instead of doing the math. The `crear_pedido` / `actualizar_pedido` confirmations show product names and the code-computed total (`confirmLines`) instead of menu keys, and an unknown order id returns `{ error }` instead of throwing.
- 668e8d9: The `ai-full` template ships example AI tools: `ver_menu`, `mis_pedidos`, `crear_pedido`, `actualizar_pedido` and `cancelar_pedido`, with products validated as an `enum` of the menu keys, `confirm: true` on the order-changing tools and `dedupe` on `crear_pedido`. Orders are kept in `ctx.user`.
- 14bcd28: The `ai` and `ai-full` templates answer in Spanish and pin the built-in texts to it (`i18n: { defaultLocale: 'es', locales: ['es'] }`), so slash commands and the AI confirmation prompts always match the persona. The `ai-full` tools gain a `title` each, product `labels`, a `confirmLines` on `cancelar_pedido` (`• Pedido: P-…` instead of `• Id: …`), `maxItems` on the order lines, case/space-tolerant order ids and an `onToolEvent` audit log with metadata only.
- c385f40: The CLI and `scaffold()` refuse a target directory inside a checkout of the bot-wa monorepo itself (a `pnpm-workspace.yaml` next to `packages/core` named `@bot-wa/core`), where the new project would join the framework workspace. Pass `--force` (`force: true`) to scaffold there anyway; other pnpm workspaces are not affected. New export: `findBotWaMonorepo()`.
- 522bcca: - Generated projects use the `defineBot` + `isMainModule` factory pattern and add `npm run dev` (`bot-wa dev src/bot.js --env-file .env`) to chat with the bot in the terminal.
  - The `ai` template ships a business-scoped customer-support persona (`BUSINESS_NAME`), per the WhatsApp Business AI policy in force since 2026-01-15.
- ea3fd2a: - New use-case templates: `games`, `support`, `store`, `restaurant`, `clinic` and `ai-full` (AI + regex intents + SQLite store + scheduler + slash commands + handoff). All of them use the v2 API, the `defineBot` factory and `npm run dev`.
  - Every generated project now ships an `AGENTS.md` for AI coding agents: the current v2 API, the v1 idioms that do not exist (`addAnswer`, `capture`, `flowDynamic`…) and the commands to run. Exported as `agentsMd()`.
  - The demo `menu` flow of the transport templates now has a `.timeout('5m')`, and `.gitignore` also ignores `*.db` files.

### Patch Changes

- 14bcd28: CLI: `--template`/`-t` and `--name` without a value (or followed by another option, as in `-t --yes`) now fail with "Option --template needs a value" instead of silently falling back to the default template. `--name @acme/support-bot` keeps its scope (it used to become `support-bot`), names are capped at npm's 214 characters, and "Next steps" lists `npm run dev` and prints an absolute `cd` path when the project is outside the current directory.
- 4d95812: `create-bot-wa` stamps `@bot-wa/*` dependency ranges derived at build time from each public package's current version (`^<exact version>`, e.g. `^2.0.0-alpha.2` or `^0.1.1-alpha.0`), instead of hand-written constants like `^0.1.0` that npm does not resolve to a prerelease — freshly scaffolded projects install while the packages are on the `alpha` line. The `@bot-wa/baileys` README links its example on GitHub (the relative link broke on npmjs.com).
- 31fcc2e: The Baileys-based templates no longer write the QR pairing payload to the logger (anyone reading the logs could link a device while the QR is valid); the `qr` handler only logs a hint, since the provider already draws the QR in the terminal.
