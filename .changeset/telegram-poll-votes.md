---
'@botmesh/telegram': minor
---

**Breaking:** polls are sent non-anonymous (`is_anonymous: false`) so their votes reach the bot: each `poll_answer` update becomes a `'poll'` event with the same shape as `@botmesh/baileys` (`vote.ref` is the poll message, `vote.senderId` the voter, `vote.options` the tally with `voters`; an empty pick withdraws the vote). Votes are tallied for the 500 most recent polls this process sent. Members of the chat can see who voted. Channels do not allow public-voter polls: a poll to a channel is retried once as anonymous (its votes never reach the bot) and that channel gets anonymous polls from then on. An explicit `platformData.is_anonymous` is never changed; `anonymousPolls: true` keeps anonymous polls (no votes), and `platformData: { is_anonymous: true }` does it for one send. Long polling now also requests `poll_answer`. New `parsePollAnswer()` wire helper and `TelegramPollAnswer` type.
