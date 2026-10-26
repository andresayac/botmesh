# ESLint plugin

`eslint-plugin-botmesh` catches in source code the mistakes no generic linter
knows about: v1 API that no longer exists, a blocking `runtime.enter()`, an
async plugin `install()`, empty triggers, waits without a timeout and per-user
state in module variables. It complements the runtime
[`bot.lint()` / `lintFlows()`](/guide/flow-tools), which inspect the
registered flows (broken gotos, unreachable steps, duplicate triggers).

It needs **ESLint 9 or later** (flat config) and Node >= 22. The `src/bot.js`
of every [`create-botmesh`](/guide/getting-started#scaffold-a-project-with-create-botmesh)
template passes the `strict` preset with no findings (the plugin's tests
check it).

## Install

```bash
pnpm add -D eslint eslint-plugin-botmesh
```

While the packages are in prerelease, add the dist-tag shown in
[Getting started](/guide/getting-started).

## Usage

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
    plugins: { 'botmesh': botmesh },
    rules: {
      'botmesh/no-v1-api': 'error',
      'botmesh/require-timeout-on-ask': ['error', { methods: ['ask', 'choose'], allowFlowTimeout: true }],
    },
  },
]
```

The rules are syntactic and need no type information. For TypeScript files,
combine the plugin with `typescript-eslint` (its parser) and list the `.ts`
files, since ESLint only lints `.js`/`.mjs`/`.cjs` by default:

```js
import botmesh from 'eslint-plugin-botmesh'
import tseslint from 'typescript-eslint'

export default [
  { ...botmesh.configs.recommended, files: ['src/**/*.{js,ts}'] },
  { files: ['src/**/*.ts'], languageOptions: { parser: tseslint.parser } },
]
```

## Presets

| Preset | Rules |
| --- | --- |
| `configs.recommended` | Errors: `no-v1-api`, `no-await-runtime-enter`, `no-async-plugin-install`, `no-empty-trigger`. Warnings: `require-timeout-on-ask`, `prefer-ctx-user-over-global-state`. |
| `configs.strict` | Every rule as an error; `require-timeout-on-ask` also checks `waitText`, `waitMedia`, `waitLocation`, `choose`, `waitAny` and flow `.form()`. |

## Rules

### `botmesh/no-v1-api`

Flags the v1 / builderbot API that does not exist in v2, and names the
replacement in the message:

| v1 | Use instead |
| --- | --- |
| `.addAnswer()` | `flow(...).say(text)` / `.ask(text, 'stateKey')` |
| `.addAction()` | `.do(async (ctx, c) => { ... })` |
| `{ capture: true }` | `.ask(text, 'stateKey')` in a flow or `await c.ask(text)` in a conversation |
| `flowDynamic()` | `ctx.reply(...)` or a `.say((ctx, c) => ...)` step |
| `gotoFlow()` | `.goto('flowName')` or `c.goto('flowName')` |
| `endFlow()` | return from the step, or `c.end(message)` |

```js
addKeyword('hola').addAnswer('Your name?', { capture: true })   // reported
flow('hola').ask('Your name?', 'name', { timeout: '5m' })        // ok
```

No options.

### `botmesh/no-await-runtime-enter`

`ConversationRuntime.enter()` resolves when the conversation **ends**.
Awaiting it in a handler blocks the chat's FIFO queue, so the message the
conversation is waiting for is never dispatched. The rule reports
`await runtime.enter(...)`, `return runtime.enter(...)` (the dispatcher awaits
the returned promise), an arrow function whose body is `runtime.enter(...)`,
and the same three forms with `.catch(...)` / `.then(...)` / `.finally(...)`
chained or with optional calls (`await runtime?.enter(...)`): the chained
promise still settles only when the conversation ends.

```js
await runtime.enter(handle, msg)                                     // reported
void runtime.enter(handle, msg).catch((err) => log.error({ err }))   // ok
```

Option: `{ receiverPattern: string }`, a regex source the receiver name must
match (default `runtime$`, case-insensitive).

### `botmesh/no-async-plugin-install`

`Plugin.install()` must be synchronous: `bot.plug()` does not await it, so
the bot runs before an async `install` has finished, and its rejection only
reaches the `'error'` event (older core versions crashed the process with an
unhandled rejection). TypeScript now rejects an async `install` at compile time
(`PluginSpec.install` returns `void | SyncInstallError`); the rule covers
JavaScript and `as any` escapes. It checks the object passed to `definePlugin(...)`, any object
literal with both `name` and `install`, and classes with an `install` method
that declare a `name` field or `implements Plugin`. For async setup use the
lazy pattern (resolve on first use, report configuration errors from a
non-fatal warmup), like `LazyProvider` in `@botmesh/ai`.

No options.

### `botmesh/no-empty-trigger`

An empty trigger (`''`, `'   '`, an empty template literal, `[]`, `['']`,
`{ pattern: '' }`) never matches a real message, or, with `contains`, matches
every message. Checked in `flow(...)` / `addKeyword(...)`, `bot.when(...)` and
the `trigger` option of `bot.conversation(name, fn, { trigger })`. The core
also throws a `TypeError` for an empty text pattern when it is registered; the
rule catches it (and `[]`) before the code runs. `flow([])` /
`addKeyword([])` is allowed: it is the idiom for a sub-flow with no trigger of
its own (run from a choose `then`, `.use()` or a `goto`); `bot.lint()` reports
the ones nothing reaches.

No options.

### `botmesh/require-timeout-on-ask`

Every wait for user input should set its timeout on purpose. Without one, the
wait falls back to the bot's `conversation.timeout`, else the built-in 5
minutes, which rarely suits both a long form and a quick yes/no. A timeout of
`0` (or `'0s'`) disables it: a user who stops answering keeps the conversation
open, capturing their messages, until a command such as `/reset`. The rule
reports both.

- Flow DSL: `.ask(text, key, { timeout })`,
  `.choose(prompt, options, key, { timeout })`, `.form(definition, { timeout })`,
  or a `.timeout(...)` anywhere on the same `flow(...)` chain (unless
  `allowFlowTimeout: false`).
- Conversations: `c.ask(text, { timeout })` and, when listed in `methods`,
  `c.waitText({ timeout })`, `c.waitMedia(types, { timeout })`,
  `c.waitLocation({ timeout })`, `c.choose(prompt, options, { timeout })` and
  `c.waitAny({ timeoutMs })`. `waitAny` takes milliseconds in `timeoutMs` and
  ignores a `timeout` key, so the rule reports `c.waitAny({ timeout })` too.
- When the options argument is not an object literal (a variable, a call) or
  contains a spread, the rule cannot see inside it and stays quiet.

```js
await c.ask('Your email?')                        // reported (falls back to the default)
await c.ask('Your email?', { timeout: 0 })        // reported (never expires)
await c.ask('Your email?', { timeout: '10m' })    // ok
await c.waitAny({ timeoutMs: 60_000 })            // ok (with 'waitAny' in methods)
```

If every wait should use the bot-wide `conversation.timeout`, turn the rule
off instead of repeating it on each step.

Options: `{ methods?: ('ask' | 'waitText' | 'waitMedia' | 'waitLocation' | 'choose' | 'waitAny' | 'form')[], allowFlowTimeout?: boolean }`
(defaults `['ask']` and `true`).

### `botmesh/prefer-ctx-user-over-global-state`

Flags the v1 `globalState` and module-level `Map`s or objects keyed by
`ctx.from`, `ctx.sender` or `ctx.senderId` (`users.get/set/has/delete(ctx.from)`,
`scores[ctx.sender]`). That state is lost on restart, grows forever and is not
shared between replicas. Use [`ctx.user`](/guide/user-data)
(`await ctx.user.ns('feature').set(key, value)`) for per-user data and
`c.state` for per-conversation data.

Short-lived per-process data that should not survive a restart, such as a
rate-limit window, is a deliberate exception: disable the rule on that line
(`// eslint-disable-next-line botmesh/prefer-ctx-user-over-global-state`).

Option: `{ contextNames: string[] }`, the names of the handler context
parameter (default `['ctx']`).

## API

```ts
import botmesh, { rules, configs, PLUGIN_NAMESPACE } from 'eslint-plugin-botmesh'

botmesh.meta      // { name: 'eslint-plugin-botmesh', version, namespace: 'botmesh' }
botmesh.rules     // the six rules, by name without the 'botmesh/' prefix
botmesh.configs   // { recommended, strict } (flat configs)
```

The rule modules are reached through `rules` (`rules['no-v1-api']`); they are
not named exports. Each rule's `meta.docs.url` points at its section of this
page, so editors link a finding to its explanation.

## See also

- [Inspect & lint flows](/guide/flow-tools)
- [Testing](/guide/testing)
- [`eslint-plugin-botmesh` README](https://github.com/andresayac/botmesh/tree/main/packages/eslint-plugin)
