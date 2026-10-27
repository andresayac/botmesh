---
"@botmesh/evolution": patch
---

Fixes found against a real Evolution API v2.3.4 server:

- A `connection.update` with `state: 'refused'` (Evolution stopped offering QR codes at `QRCODE_LIMIT` without pairing) was dropped, so the bot waited for a QR that never came. It is now a `closed` update with reason `sessionInvalid` and a `detail.message` telling you to call `start()` again. Close codes are classified like `@botmesh/baileys`: 401/500/411 → `sessionInvalid`, 440/403 → `sessionTakenOver`, anything else → `transient`.
- `deleteMessage(ref)` with a ref that has no native key (read back from a store) sent `fromMe: false`, so Evolution tried to delete someone else's message. It now assumes the bot's own message (`fromMe: true`), like Baileys; a native key keeps its `fromMe`.
- Polls are checked before calling Evolution (2 to 12 options, no empty question or option, no repeated options) and reject with `UnsupportedContentError`, like Baileys.
- `toEvolutionError` explains the errors Evolution answers when the instance has no WhatsApp session (the `TypeError` of an instance that never connected, and HTTP 500 `Connection Closed` after a logout): "The Evolution instance is not connected to WhatsApp: call start() and pair it".
- `ingest()` logs a warning when an authenticated webhook body is not Evolution JSON (usually a missing body parser), and a 401 log names the expected header (never the secret).
- `key.previousRemoteJid` (the LID Evolution swaps for `senderPn`) is linked to the contact's canonical id on messages that are not `fromMe`.
