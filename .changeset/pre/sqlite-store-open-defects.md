---
'@botmesh/sqlite-store': minor
---

- `saveMessage` and `setCursor` reject (`TypeError`) a message id, chat id, cursor key or cursor value that contains a lone UTF-16 surrogate. SQLite stores text as UTF-8, where such a character becomes U+FFFD, so two different ids could share one row (or a value came back changed). `getMessage`/`getCursor` with such a key find nothing.
- `schedules()` and `durability()` on a stopped store reopen the database (and re-point the backends already handed out) instead of failing later with better-sqlite3's "The database connection is not open".

What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
