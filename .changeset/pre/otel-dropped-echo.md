---
"@botmesh/otel": patch
---

`botmesh.dropped` now reports the echoes that `BotConfig.echoFilter` drops (`reason: 'echo'`), like the Prometheus exporter of the core already did. Without the filter nothing changes: no `echo` point is observed.
