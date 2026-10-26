# Examples

Complete bots you can copy and run. Each page has one runnable file, a
walkthrough, a transcript captured from a real run and the guides of every
feature it shows. Every example is executed by the test suite, so the code on
these pages works with the current release.

Start them in the terminal simulator (`npx botmesh dev <file>`) and connect a
real channel when you are happy with them.

## Advanced

| Example | Level | Tags | Features | What you build |
| --- | --- | --- | --- | --- |
| [WhatsApp Cloud API webhook server](./cloud-api-webhook) | Advanced | WhatsApp, Cloud API, Webhooks, Security | `@botmesh/meta` webhooks, raw-body signatures, 24-hour window, templates | A `node:http` server for the official Cloud API, with template fallback |
| [Production-ready bot](./production-bot) | Advanced | Production, Docker, SQLite, Durability | `SQLiteStore`, durability, persistent flows, health and metrics, graceful shutdown, logs | A support bot packaged as a small project with a Dockerfile |
| [Scheduled daily digest](./daily-digest) | Advanced | Scheduler, Broadcast, Time zones | Durable scheduler, time zones, `bot.broadcast`, `ctx.user` opt-in/out | A digest at 08:00 in the bot's time zone, once per day across restarts |
| [Testing your bot](./testing-your-bot) | Advanced | Testing, Vitest, Golden transcripts | `createTestBot`, `expectReply`, golden transcripts, replay | A complete Vitest file that records and replays a conversation |
| [Build a plugin: FAQ with tools](./faq-plugin) | Advanced | Plugins, Dependency injection | `definePlugin`, `install`/`uninstall`, `ctx.onDispose`, `provide` | A reusable FAQ plugin that shares its counters as a tool |
