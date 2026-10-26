---
'@botmesh/baileys': minor
---

Fixes for the low-severity defects left open by the alpha exit review:

- **Behaviour change:** a text edit is now delivered as a message with the new text and the ORIGINAL `ref.id` (like `@botmesh/telegram`), instead of being dropped. `isEditedMessage(ctx)` tells it apart, and the new `editedMessages: 'ignore'` option restores the old behaviour. The core dedupe lets an edit through (new content, same id) and drops an identical retry. Only an edit of a message this process has seen, sent in the same chat by the user who sends the edit, is delivered: an edit naming another participant's message, one of the bot's own, a message from another chat or an original no longer in the message cache (for example after a restart) is dropped.
- **Breaking:** `toJid()` throws a `TypeError` for input without digits (it returned `'@s.whatsapp.net'`) and for `{ groupId, userId }` (it returned an invalid `…@g.us:<user>` string; a group participant has no JID of its own: use `toJid({ groupId })` for the chat and `toJid(userId)` for the person). An old-style group id keeps its hyphen (`<creator>-<timestamp>@g.us`).
- `reconnect` also takes a policy object, `{ maxAttempts, baseMs, capMs }` (defaults 10, 1000, 30000), validated at construction; the `ReconnectPolicy` type is exported.
- `RateLimiter.reset()` (run by `stop()`) cancels the limiter's pending sleeps, so a long jitter no longer keeps the process alive, and a send that was sleeping in its jitter is rejected instead of going out after the reset.

What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
