---
'@botmesh/meta': patch
---

Cards and URL buttons no longer lose content silently on the Cloud API:

- A `Button` with `url` goes out as a native `cta_url` link button (label cut to 20 characters) instead of a reply button without the link. Graph allows one per message, so several URL buttons, or a URL button mixed with reply buttons, reject with `UnsupportedContentError`.
- A `card` keeps its `imageUrl` (an image message with the title and body as caption, or the header of the interactive message) and its `buttons` (native reply or `cta_url` buttons).
- **Behavior change (bug fix):** a card with more than 3 buttons, or with a mix of links and replies, now rejects with `UnsupportedContentError` instead of going out as plain text without them.
