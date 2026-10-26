---
'@botmesh/core': patch
---

An empty or blank text trigger (`bot.when('')`, `'   '`, `['hola', '']`, `{ pattern: '' }`, `flow('')`, a conversation `trigger: ''`) throws a `TypeError` when it is registered. It used to match every message without text (a photo without caption), or every message with `contains`/`startsWith`/`endsWith`. `[]` is still accepted (it never matches; the usual trigger of a flow entered only by `goto()`). Use `IMAGE`/`MEDIA` for media and `bot.onMessage()` for a catch-all.
