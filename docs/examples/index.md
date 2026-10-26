# Examples

Complete bots you can copy and run. Each one is a single `bot.js` that runs in
the terminal simulator (`npx botmesh dev bot.js`) and on a real channel
(`node bot.js`), and lists the features it shows with links to their guides.
Every example on this site is run by the botmesh test suite, transcript
included.

## Intermediate

| Example | Level | Tags | Features | What you'll build |
| --- | --- | --- | --- | --- |
| [Appointment booking](./appointment-booking) | Intermediate | WhatsApp, Forms, SQLite | `.persistent()`, `.form()`, `validate` + `maxAttempts`, `SQLiteStore`, `ctx.user` | A booking flow that validates, confirms and resumes after a restart |
| [Order tracking](./order-tracking) | Intermediate | WhatsApp, User data | `ctx.user` namespaces, `bot.conversation()`, `MemoryStore` file | Order lookups that remember what each user follows |
| [Human handoff](./human-handoff) | Intermediate | WhatsApp, Support | `ctx.handoff()`, `bot.resume()`, handoff events, agent commands, `bot.delay()` | A support bot that passes chats to agents and takes them back |
| [Multi-language bot](./multi-language) | Intermediate | WhatsApp, Telegram, i18n | `bot.locale()`, `ctx.t()`, `detect`, `ctx.setLang()`, plurals | A bot that answers each user in English or Spanish |
| [Group bot](./group-bot) | Intermediate | WhatsApp, Telegram, Groups | per-participant conversations, `scope`, mentions, `groupMode`, admin-only commands | A group quiz with a scoreboard and admin commands |
| [WhatsApp and Telegram at once](./whatsapp-and-telegram) | Intermediate | WhatsApp, Telegram, SQLite | `defineBot`, two providers, store namespaces, stable ids | One bot file serving two channels from one process |
