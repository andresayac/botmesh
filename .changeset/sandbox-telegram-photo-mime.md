---
'@botmesh/telegram': patch
---

An inbound photo now carries `media.mimetype: 'image/jpeg'`. Telegram re-encodes every photo as JPEG and sends no `mime_type` for it, so `loadMediaOf(ctx)` reported `application/octet-stream` for photos.
