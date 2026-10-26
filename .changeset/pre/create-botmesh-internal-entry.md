---
'create-botmesh': minor
---

New `create-botmesh/internal` entry (no semver) with `TEMPLATES`, `agentsMd`, `AgentsMdInfo` and `findBotMeshMonorepo`. The main entry keeps them as deprecated re-exports until stable; use `getTemplate(name)` and `TEMPLATE_NAMES` instead of `TEMPLATES`. The CLI does not change.
