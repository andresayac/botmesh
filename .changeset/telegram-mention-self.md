---
"@botmesh/telegram": patch
---

Mentioning the bot by its username now counts as a mention: an `@MyBot` in a group message (a `mention` entity) and a command addressed as `/cmd@MyBot` add the bot's `selfId` to `ctx.mentions`. Before, only `text_mention` entities were collected, so `groupMode: 'mentions'` dropped every message that mentioned the bot by name.
