# Examples

Complete bots you can copy, run and adapt. Each example is one `bot.js`
file that shows a set of botmesh features, with a transcript captured from a
real run and links to the guide of every feature it uses. A test runs every
example's code and checks its transcript, so what you read is what you get.

## Run any example

1. Set up a project once, as in
   [Getting started](/guide/getting-started#requirements) (Node.js 22.12+,
   `"type": "module"`, `npm install @botmesh/core @botmesh/baileys`).
2. Save the example's code as `bot.js`.
3. Chat with it in the terminal, no phone needed:

   ```bash
   npx botmesh dev bot.js
   ```

4. Connect it for real with `node bot.js` (a QR code for WhatsApp), or swap
   the provider for [Telegram](/guide/getting-started#or-connect-telegram).
   The bot code does not change between channels.

## All examples

| Example | Level | Tags | Features | What you'll build |
| --- | --- | --- | --- | --- |
| [Greeting bot](./greeting-bot) | Beginner | Commands | `WELCOME`, text and regex triggers, `ctx.pass()`, slash commands, catch-all | A bot that welcomes each user once, says hello, echoes and lists its commands |
| [FAQ bot](./faq-bot) | Beginner | Triggers | Normalized matching, keyword lists, `contains`, regex, precedence | Keyword answers to frequent questions, with a fallback |
| [Send messages](./messages) | Beginner | Triggers | Trigger forms, `ctx.quote()`, `ctx.react()`, sender info | Every way to answer a text message |
| [Menu bot](./menu-bot) | Beginner | Flows, Buttons | `flow().choose()`, `then` sub-flows, `bot.conversation()`, buttons per channel | A pizza-place menu that works on every channel |
| [Poll bot](./poll-bot) | Beginner | Polls, Reactions | `ctx.poll()`, `bot.on('poll')`, `bot.send()`, `ctx.react()` | Native polls answered with the live tally |
| [Media replies](./media) | Beginner | Media | Photo, file, video, voice, sticker, location, contact; `bot.onType()`, `loadMediaOf()` | A bot that sends every media kind and reacts to images |
| [Reminder bot](./reminders) | Beginner | Scheduler | `bot.delay()`, `bot.schedule()` with time zone, `task.cancel()`, `bot.send()` | One-off reminders and a daily tip at 9:00 |
| [Registration flow](./registration-flow) | Beginner | Flows, Forms | `.ask()` with `validate`, `.do()`, `c.state`, `.timeout()`, `/cancel` | A validated sign-up that saves the user |
| [Shopping flow](./shopping-flow) | Intermediate | Flows | `.choose()`, `then` sub-flows, `goto`, computed state, timeouts | A small shop with quantity, confirmation and address |
| [Support with timeout](./support-flow) | Intermediate | Conversations | `bot.conversation()`, `c.waitText()`, `c.choose()`, `ConversationTimeout`, `ConversationCancelled` | A support desk that opens tickets and handles abandoned sessions |
| [Plugin: rate limiter](./rate-limiter) | Intermediate | Plugins, Hooks | `definePlugin()`, `before('message')`, `abort()`, `onDispose()` | A reusable plugin that limits messages per user |

The bot code of every example is the same on WhatsApp (Baileys) and
Telegram: only the provider changes. Where a channel renders something
differently (buttons, stickers), the example page says so, and the
[capability matrix](/guide/channels#capability-matrix) lists the details.
