---
'@botmesh/telegram': minor
---

Fixes for the low-severity defects left open by the alpha exit review:

- Webhook mode: `ingest()` after `stop()` answers `503` and emits nothing (before, Updates kept reaching a stopped bot); Telegram redelivers them after the restart. A `start()` that races `stop()` (stop while `getMe` is in flight) no longer emits `ready` after `closed`.
- `/menu@MyBot` at the start of a photo or document caption reaches `bot.command('menu')`, like in a text message.
- A 429 `retry_after` is capped at 24 h (a huge value overflowed the timer and retried at once), and a negative or non-numeric one means 1 s.
- New `uploadTimeoutMs` option (default 5 minutes, or `requestTimeoutMs` when larger) for file uploads; `requestTimeoutMs` no longer cuts a slow upload.
- At most 1000 draft stop callbacks (`sendDraft(..., { onStop })`) are kept, dropping the oldest, so a burst of drafts cannot grow the map within its 10-minute TTL.
