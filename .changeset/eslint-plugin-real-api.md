---
'eslint-plugin-botmesh': patch
---

Align the rules with the real @botmesh API. `require-timeout-on-ask` accepts a flow `.choose(prompt, options, key, { timeout })`, checks `c.waitAny()` for `{ timeoutMs }` (and reports the ignored `{ timeout }`), adds `waitLocation` and flow `.form()` to `methods` and to the `strict` preset, and reports a zero timeout, which never expires. `no-empty-trigger` allows `flow([])`, the trigger-less sub-flow idiom. `no-await-runtime-enter` catches `await runtime?.enter(...)` and a returned `runtime.enter(...).catch(...)`, and explains an invalid `receiverPattern`. `prefer-ctx-user-over-global-state` also sees `ctx?.from` and `seen.add(ctx.from)`, and no longer reports read-only lookups such as `ADMINS.has(ctx.from)` on a constant allow/deny list: a keyed read is reported only when the same binding is written or reassigned inside a function.
