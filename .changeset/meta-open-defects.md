---
'@botmesh/meta': minor
---

Fixes for the low-severity defects left open by the alpha exit review:

- An interactive webhook reply that is not a button or list press (for example `call_permission_reply`) was emitted as a `button` interaction with empty data. It now arrives as an `unknown` message with the raw payload in `ref.native`.
- Graph's interactive limits are checked before sending, with an `UnsupportedContentError` that says what to change: a `buttons`/`card` with no button, repeated button ids or titles (compared after the 20-character cut), a list with no rows, more than 10 rows in total or repeated row ids.
- Interactive labels are cut on grapheme boundaries (never more code points than Graph allows): an emoji ZWJ sequence or a flag is kept whole or dropped, never split into another symbol.
- A failed status' `errors[0]` is checked: `code` is kept only when it is a number (a digit string is converted) and the text only when it is a string, clipped to 1000 characters.
- New `uploadTimeoutMs` option (default 5 minutes, or `requestTimeoutMs` when larger) for media uploads, which can be up to 100 MB; `requestTimeoutMs` (60 s) no longer cuts them.
- `phoneNumberId` may be a safe positive integer again (it is used as a string); other numbers still fail with an error naming the field.
