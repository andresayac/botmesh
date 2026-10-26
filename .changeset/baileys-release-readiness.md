---
'@botmesh/baileys': patch
---

Release-readiness fixes found by an end-to-end review of the WhatsApp (Baileys) transport:

- **Protocol stanzas are no longer delivered as messages.** Baileys upserts every stanza before processing it, so reactions, deletes and edits (`protocolMessage`), sender-key distributions and placeholders for messages that failed to decrypt reached the bot as `type: 'unknown'` messages: a catch-all handler answered every reaction, and an active `ask` took a reaction as its answer. They are now skipped (reactions still arrive as the `reaction` event). Reactions in statuses, broadcast lists and channels follow the same `ignoreBroadcasts`/`ignoreNewsletters` filter as messages.
- **One malformed event no longer drops the rest of its batch.** Each Baileys event kind, and each upserted message, is handled in isolation; a failure is logged (`err` only, never a body) and the other events still arrive. Emitted message ids and bodies are always strings.
- **`start()`/`stop()` races:** a `stop()` while `start()` is still loading the auth state or the WhatsApp Web version no longer leaves a live socket behind, and a second `start()` ends the previous socket instead of opening two on one session (WhatsApp would close one with 440).
- **A rejecting or throwing `qr.handler` is logged** instead of crashing the process with an unhandled rejection.
- **`reconnect exhausted`** is now emitted (as a final `closed` event) when transient drops use up the reconnect attempts, not only when `start()` keeps failing.
- **Voice notes and stickers accept URLs and streams**, as the guides show (`ctx.voice(url)`, `ctx.sticker(url, …)`): URLs are downloaded through the same SSRF-safe fetcher as other media and streams are capped at `remoteMedia.maxBytes`. Before, they failed with "Remote URL not supported here".
- **Sticker `pack`/`author` are written** into the WebP's EXIF metadata WhatsApp reads; they were silently ignored.
- **`sharp` and `ffmpeg` load lazily**, on the first sticker or voice note: a platform where one of them cannot load still imports the package and sends text, and the media send fails with an actionable `UnsupportedContentError`.
- **Clear errors for content WhatsApp cannot carry:** polls need a question and 2–12 unique, non-empty options (duplicate names made votes indistinguishable); a missing local media file or an unsupported media source rejects with `UnsupportedContentError` instead of an opaque `ENOENT`. Voice/sticker conversion failures are `UnsupportedContentError` too.
- **Reactions to a ref without its native message** (e.g. read back from a store) rebuild the target key instead of failing with a `TypeError`.
- **Contact cards escape the display name**, so it cannot inject vCard fields.
- **Poll votes keep only the poll's own option hashes**, so a crafted vote cannot bloat the tally or the `pollStore` entry.
- **`deleteMessage()` rejects with typed `ProviderError` subclasses** like `send()`.
- **Config mistakes fail in the constructor:** a `pairingCode` without a usable phone number (6–15 digits) and an unknown `browser` preset or malformed tuple throw a `TypeError` with the accepted values. Before, the first fell back to the QR after a warning and the second was silently ignored.
