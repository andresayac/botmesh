---
"@botmesh/messenger": patch
---

Fixes from the beta release test:

- No outbound text is cut or rejected: a list sends its text before the generic template (the template has no header, so the text was dropped), button text past the template's 640 characters goes first as plain text, `buttons` with no buttons is plain text, and card or list text over 2000 characters is split into several messages instead of failing at Graph.
- Button and template labels are cut on grapheme boundaries (an emoji ZWJ sequence was split into a different symbol).
- Inbound: a `message_edits` webhook arrives as a message with the original id (new `isEditedMessage()` export); every attachment of a multi-attachment message reaches the bot (ids `<mid>`, `<mid>#2`…; only the first one did); a location keeps the place name Meta sends next to its payload; a shared link (`fallback` attachment) is a text message with its title and URL instead of a "document" whose download fetched the web page; a postback without `mid` gets a stable id from its timestamp, so a Meta retry is deduplicated.
- Message tags: `options.platformData` sets `tag`, `messaging_type`, `notification_type` and `persona_id` (a tag implies `MESSAGE_TAG`; a wrong type throws a `TypeError`; other keys are ignored). The README pointed to `ctx.sendNative()` for tags, which could not set them.
- The page id and API version are URL-encoded in the Send API path.
