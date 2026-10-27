# eslint-plugin-botmesh

## 1.0.0-beta.0

### Major Changes

- 7e9c369: First public release of `eslint-plugin-botmesh` (ESLint 9+ flat config): six rules for botmesh bots and the `recommended` / `strict` presets.
  
  - **API freeze (main entry: 14 names before, 8 after).** The entry exports the plugin (default), `rules`, `configs`, `PLUGIN_NAMESPACE` and the `BotMeshPlugin` / `BotMeshConfigs` types (`BotWaPlugin` / `BotWaConfigs` stay as deprecated aliases). The rule modules are no longer named exports (`noV1Api`, `noAwaitRuntimeEnter`, …): reach them through `rules['no-v1-api']`.
  - `meta.version` is read from `package.json` instead of a hard-coded `0.1.0`.
  - Every rule links to its section of the guide (`meta.docs.url`), so editors show a "rule documentation" link.

### Patch Changes

- 23d8509: Align the rules with the real @botmesh API. `require-timeout-on-ask` accepts a flow `.choose(prompt, options, key, { timeout })`, checks `c.waitAny()` for `{ timeoutMs }` (and reports the ignored `{ timeout }`), adds `waitLocation` and flow `.form()` to `methods` and to the `strict` preset, and reports a zero timeout, which never expires. `no-empty-trigger` allows `flow([])`, the trigger-less sub-flow idiom. `no-await-runtime-enter` catches `await runtime?.enter(...)` and a returned `runtime.enter(...).catch(...)`, and explains an invalid `receiverPattern`. `prefer-ctx-user-over-global-state` also sees `ctx?.from` and `seen.add(ctx.from)`, and no longer reports read-only lookups such as `ADMINS.has(ctx.from)` on a constant allow/deny list: a keyed read is reported only when the same binding is written or reassigned inside a function.
