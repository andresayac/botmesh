---
"@botmesh/sqlite-store": patch
---

Document that Node.js 24.19+ needs `better-sqlite3` 13: versions 11 and 12 can abort the process when a prepared statement is garbage-collected (nodejs/node#65446). The package is now tested against `better-sqlite3` 13.

With `better-sqlite3` 13, a missing native binary (no prebuild for the platform and no build) is reported as "Cannot find module …/better_sqlite3.node"; `SQLiteStore` now turns it into the same actionable "native module was never built" error as with versions 11 and 12.
