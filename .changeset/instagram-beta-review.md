---
"@botmesh/instagram": patch
---

Beta review fixes: media captions are sent as a text message after the attachment and a card `imageUrl` as an image after the card text, or alone when the card has no text (both were dropped); a card with no text and no image is rejected; a DM with several photos yields one message per attachment (`<mid>`, `<mid>#2`…) instead of only the first; the user's text is kept next to a shared post or an unknown attachment; `selfId` marks the account's own messages `fromMe`; `ingest()` answers `503` while stopped so Meta redelivers; quick replies are cut on grapheme boundaries and reject an empty text, an empty title, duplicate ids or titles and ids over 1000 characters; a `{ url }` media source must be http(s); `apiVersion`/`graphUrl` are validated at construction and an explicit `undefined` keeps the default; a blank `verifyToken` or `appSecret` fails in the constructor.
