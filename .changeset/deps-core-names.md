---
'@botmesh/core': major
---

**Breaking: `botmesh` names for metrics and the simulator.**

- `toPrometheus()` names every metric family `botmesh_*` (was `botwa_*`). Pass `{ prefix: 'botwa_' }` to keep the alpha names in existing dashboards and alerts.
- `botmesh dev` sets `BOTMESH_DEV=1` for the bot code; the old `BOT_WA_DEV=1` is still set (deprecated). The hot-reload query parameter is now `botmesh_v`.
- The media marker of durable inbox records stays `$botwaMedia` (permanent: journals already written hold it).
