---
'@botmesh/core': patch
'@botmesh/baileys': patch
'@botmesh/meta': patch
'@botmesh/telegram': patch
'@botmesh/sqlite-store': patch
'@botmesh/redis-store': patch
'@botmesh/ai': patch
'@botmesh/http': patch
'@botmesh/graph-core': patch
'create-botmesh': patch
---

The docs site is now published at https://andresayac.github.io/botmesh/. Each package's `homepage` points to its page there (the site root for `@botmesh/core`), and the README links to the guides open the site instead of the Markdown sources on GitHub (the `@botmesh/ai` README link to the side-effecting tools section also had a stale anchor).
