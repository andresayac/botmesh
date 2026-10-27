---
"@botmesh/moderation": patch
---

Harden the moderation plugin:

- The config is validated by `moderationPlugin()`, `new Moderator()` and `setGroupRules()`: an unknown action, a non-positive count, window or `muteMs`, or a field of the wrong type throws a `TypeError`/`RangeError` that names the field (a typo such as `action: 'ban'` used to fail on the first violation and drop the message). `mute()` rejects a non-positive duration.
- An `isAdmin` callback that throws is logged and the sender is treated as a non-admin, instead of every group message failing to dispatch.
- Admins are looked up only for messages that break a rule or come from a muted user. A failing `groups.getAdmins` keeps the last known list and is retried after `min(adminCacheMs, 30s)` rather than on every message.
- Words and links are matched after dropping invisible characters and folding compatibility forms, so a zero-width-split word, fullwidth `ｓｐａｍ` or a zero-width-split invite no longer slips through. An invite host must start its hostname (`chat.me/+abcd` is not a Telegram invite), while WhatsApp formatting marks around a link (`_chat.whatsapp.com/…_`, `*…*`, `~…~`) do not hide it from the invite or `allLinks` filters.
- `{name}` in warnings is a sanitized one-line display name of at most 64 characters.
- Anti-spam windows of different lengths no longer reset each other under load, and the idle-key sweep is amortized.
- Unplugging removes `ctx.tools.moderation`.
