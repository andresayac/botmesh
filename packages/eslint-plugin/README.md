# eslint-plugin-botmesh

ESLint rules for [botmesh](https://andresayac.github.io/botmesh/) bots. They catch in source code the mistakes no generic linter knows about: v1 API calls that no longer exist, a blocking `runtime.enter()`, an async plugin `install()`, empty triggers, waits without a timeout and per-user state in module variables.

They complement the runtime `bot.lint()` / `lintFlows()` of [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core), which inspect the registered flows (broken gotos, unreachable steps, duplicate triggers).

## Install

```bash
pnpm add -D eslint eslint-plugin-botmesh
```

ESLint 9 or later (flat config), Node.js 22 or later, ESM only. No runtime dependencies; `eslint` is a peer dependency.

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older prerelease. Add the prerelease dist-tag to get the build these docs describe: `pnpm add -D eslint-plugin-botmesh@beta` during the beta (`npm view eslint-plugin-botmesh dist-tags` lists the tags). Once stable, the plain command above works.

## Quick start

```js
// eslint.config.js
import botmesh from 'eslint-plugin-botmesh'

export default [
  botmesh.configs.recommended,
]
```

Or rule by rule:

```js
import botmesh from 'eslint-plugin-botmesh'

export default [
  {
    plugins: { botmesh },
    rules: {
      'botmesh/no-v1-api': 'error',
      'botmesh/require-timeout-on-ask': ['error', { methods: ['ask', 'choose'], allowFlowTimeout: true }],
    },
  },
]
```

The rules are syntactic and need no type information, so they work on JavaScript and, combined with `typescript-eslint`, on TypeScript.

## Presets

| Preset | Contents |
| --- | --- |
| `configs.recommended` | Errors: `no-v1-api`, `no-await-runtime-enter`, `no-async-plugin-install`, `no-empty-trigger`. Warnings: `require-timeout-on-ask`, `prefer-ctx-user-over-global-state`. |
| `configs.strict` | Every rule as an error; `require-timeout-on-ask` also checks `waitText`, `waitMedia`, `choose` and `waitAny`. |

## Rules

| Rule | What it catches | Options |
| --- | --- | --- |
| `botmesh/no-v1-api` | The v1 / builderbot API that does not exist in v2: `.addAnswer()`, `.addAction()`, `{ capture: true }`, `flowDynamic()`, `gotoFlow()`, `endFlow()`. The message names the replacement. | none |
| `botmesh/no-await-runtime-enter` | `await runtime.enter(...)` (or returning its promise from a handler): it resolves when the conversation **ends**, so it blocks the chat queue. Start it with `void runtime.enter(...).catch(...)`. | `{ receiverPattern }` (default `runtime$`) |
| `botmesh/no-async-plugin-install` | An `async install()` in `definePlugin({...})`, a plugin object literal or a plugin class: `bot.plug()` does not await it. | none |
| `botmesh/no-empty-trigger` | `''`, `'   '`, `[]`, `['']` or `{ pattern: '' }` as a trigger of `flow()`, `addKeyword()`, `bot.when()` or a conversation. | none |
| `botmesh/require-timeout-on-ask` | An answer wait without a timeout (`.ask()` without `{ timeout }` or a `.timeout()` in the chain; `c.ask()` and, when configured, `c.waitText` / `c.waitMedia` / `c.choose` / `c.waitAny`). | `{ methods, allowFlowTimeout }` (default `['ask']`, `true`) |
| `botmesh/prefer-ctx-user-over-global-state` | `globalState` (v1) and module-level `Map`s or objects indexed by `ctx.from`, `ctx.sender` or `ctx.senderId`: lost on restart and not shared between replicas. Use `ctx.user`. | `{ contextNames }` (default `['ctx']`) |

Every rule links to its section of the [guide](https://andresayac.github.io/botmesh/guide/eslint) (`meta.docs.url`), so editors show the documentation link next to the finding.

## API

```ts
import botmesh, { rules, configs, PLUGIN_NAMESPACE } from 'eslint-plugin-botmesh'

botmesh.meta     // { name: 'eslint-plugin-botmesh', version, namespace: 'botmesh' }
botmesh.rules    // the six rules, by name without the 'botmesh/' prefix
botmesh.configs  // { recommended, strict } (flat configs)
```

Types: `BotMeshPlugin` and `BotMeshConfigs` (`BotWaPlugin` / `BotWaConfigs` are deprecated aliases).

## Troubleshooting

- **The preset seems ignored:** the presets are flat-config objects. Put them as items of the exported array (`export default [botmesh.configs.recommended]`); a legacy `.eslintrc` cannot load them.
- **`require-timeout-on-ask` does not warn:** when the options argument is not an object literal (a variable or a spread), the rule cannot see it and stays silent on purpose.
- **A rule fires outside your bot code:** the rules key on botmesh names (`flow`, `addKeyword`, `bot.when`, `runtime.enter`). Scope the config with `files`, for example `{ ...botmesh.configs.recommended, files: ['src/bot/**'] }`.

## Links

- [ESLint plugin guide](https://andresayac.github.io/botmesh/guide/eslint) · [Inspect & lint flows](https://andresayac.github.io/botmesh/guide/flow-tools)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/eslint-plugin/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/eslint-plugin) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver.
