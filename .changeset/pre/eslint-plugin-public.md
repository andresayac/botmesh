---
'eslint-plugin-botmesh': major
---

First public release of `eslint-plugin-botmesh` (ESLint 9+ flat config): six rules for botmesh bots and the `recommended` / `strict` presets.

- **API freeze (main entry: 14 names before, 8 after).** The entry exports the plugin (default), `rules`, `configs`, `PLUGIN_NAMESPACE` and the `BotMeshPlugin` / `BotMeshConfigs` types (`BotWaPlugin` / `BotWaConfigs` stay as deprecated aliases). The rule modules are no longer named exports (`noV1Api`, `noAwaitRuntimeEnter`, …): reach them through `rules['no-v1-api']`.
- `meta.version` is read from `package.json` instead of a hard-coded `0.1.0`.
- Every rule links to its section of the guide (`meta.docs.url`), so editors show a "rule documentation" link.
