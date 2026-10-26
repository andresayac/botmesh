---
'@botmesh/meta': minor
---

Release hardening of `CloudAPIProvider`:

- New `requestTimeoutMs` option (default `60000`): every Graph request (send, upload, mark read, media lookup) now rejects with a `ProviderError` when it takes longer, instead of hanging the send forever.
- The constructor fails fast, naming the field, when `accessToken`, `phoneNumberId` or `verifyToken` is missing or empty.
- **Behavior change (bug fix):** more than 3 reply buttons now reject with `UnsupportedContentError` instead of silently dropping the extra options; send a list instead. Button, list and section titles are cut on characters (never inside an emoji) and list row descriptions are capped at 72 characters.
- Malformed webhook fields never reach the bot with the wrong type: bodies, captions and emoji are strings, media fields are strings or absent, and timestamps are finite (`0` when malformed).
- The media id is URL-encoded in the Graph path, `UnsupportedContentError.kind` names the real media kind, the poll error is in English, and `SessionWindowReopenedError` no longer puts the phone number in its message (it stays on `.chatId`).
