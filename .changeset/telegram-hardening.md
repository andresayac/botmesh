---
"@botmesh/telegram": minor
---

Release-readiness hardening of the Telegram provider:

- `stop()` now returns at once even while the poll loop waits out a `retry_after` or an error backoff (the wait is aborted and its timer cleared).
- `ready` no longer waits up to a full idle `pollTimeout`: the first `getUpdates` round uses `timeout: 0`.
- New `requestTimeoutMs` option (default 120000): every Bot API request has a client timeout; long polls get `pollTimeout` + up to 15 s, so a half-open connection can no longer silence the bot forever.
- Network failures reject with a `ProviderError` (method name + redacted cause) instead of a raw `TypeError`, and no error message, `cause` or log line carries the bot token (Node's fetch errors can quote the request URL).
- The inbound normalizer type-checks every field: a malformed or hostile Update is skipped and logged (without its content) instead of throwing into the poll loop or the host's webhook route; `ingest()` answers 200 for it.
- `ingest()` accepts the raw body as `Buffer`/`Uint8Array` (the `@botmesh/server` default) and reads the secret header in any case, from plain objects or Fetch `Headers` (new exported type `TelegramWebhookHeaders`).
- Group commands addressed to this bot (`/menu@MyBot`) reach `bot.command('menu')`; new `username` option for when `selfId` skips `getMe`. `parseUpdate()` takes an optional third `botUsername` argument.
- Clearer configuration errors: a missing token, a non-http(s) `baseUrl` or negative/non-numeric timings throw a `TypeError` from the constructor; a media string that is neither a URL nor a readable file explains how to reuse a `file_id` (`{ native }`), with the right content kind.
- Inline-keyboard button text is cut on code points (no half emoji).
