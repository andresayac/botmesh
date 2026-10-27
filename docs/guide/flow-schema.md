# JSON flow schema

`@botmesh/flow-schema` defines **versioned, code-free flow documents**: JSON that you can store, edit in a UI and hot-swap, that a deployment gate validates, and that compiles to a core `CompiledFlow`.

```bash
pnpm add @botmesh/core @botmesh/flow-schema
```

The main entry is covered by semver; the expression engine and the compiler's metadata helpers live in `@botmesh/flow-schema/internal`, with no semver guarantee.

A document is **data only**. It never carries functions, `eval`, module imports or arbitrary expressions: the only computation is a safe expression language and <code v-pre>{{ path }}</code> templates.

```ts
import { compileFlowDocument, validateFlowDocument } from '@botmesh/flow-schema'

const document = {
  version: 2 as const,
  id: 'checkout',
  trigger: { keywords: ['buy', 'order'], match: 'contains' },
  timeout: '5m',
  steps: [
    { kind: 'ask' as const, text: 'Your name?', stateKey: 'name' },
    { kind: 'condition' as const, if: 'len(name) > 2', then: [{ kind: 'say' as const, text: 'Hi {{name}}' }] },
    { kind: 'handoff' as const, reason: 'checkout' },
  ],
}

if (validateFlowDocument(document).length === 0) bot.registerFlow(compileFlowDocument(document))
```

## Document

| Field | Notes |
| --- | --- |
| `version` | `2`. A version 1 document is still accepted and migrated on load (its `retries: N` becomes `maxAttempts: N`); use `migrateFlowDocument()` for older shapes. |
| `id` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`; the flow's name on the bot. |
| `trigger` | A keyword, an array, or `{ keywords, match: 'equals' \| 'contains' \| 'startsWith' \| 'endsWith', scope: 'dm' \| 'group' \| 'all' }`. |
| `timeout` | Flow timeout (ms or `'30s'`, `'5m'`, `'1h'`; at most 7 days). |
| `persistent` | Survive a restart (requires a persistent store). |
| `steps` | At least one step; at most 500 in total (nested steps included), 8 levels deep. |

## Steps

| Kind | What it does |
| --- | --- |
| `say` | Sends text (templates allowed). |
| `ask` | Sends text, waits for an answer and stores it in `c.state[stateKey]`; optional `timeout`, `maxAttempts` (answers in total) or `retries` (after the first) and `validate: { expr, message }`: `$answer` holds the raw answer, and only `$answer`, `$body`, `$from`, `$sender` and `$isGroup` are in scope there (`c.state` is not; the validator reports any other variable). |
| `choose` | Numbered menu (`options: [{ key, label, steps? }]`), stores the picked key. |
| `condition` | `if` expression plus `then`/`else` nested steps. |
| `delay` | Pauses (`'500ms'`… at most 5 minutes). |
| `goto` | Jumps to another registered flow. |
| `end` | Ends the conversation, with an optional farewell. |
| `media` | Sends `image`, `video`, `audio`, `voice`, `document`, `sticker` or `location`. File media needs `source: { url }` (http/https) or `{ stateKey }` (an absolute https URL stored in state, as a string or `{ url }`, whose host is public); location needs `latitude`/`longitude`. |
| `form` | Native form (or degraded question-by-question) with typed fields; see [Forms](./forms.md). |
| `guard` | `if` expression; when false it sends `message` and ends, or `message` + `redirect` to another flow. |
| `subflow` | Runs another document inline (same state), resolved by `resolveSubflow`. |
| `http` | Declarative HTTP request through `@botmesh/http` (anti-SSRF, redirects, timeout and size limits). Stores the JSON/text body in `stateKey`. <code v-pre>{{ path }}</code> placeholders are allowed only in the URL's path, query or fragment (never in the scheme, credentials, host or port); their values are percent-encoded and a bare `.` or `..` value is refused. String values of the JSON `body` take placeholders too (a string that is exactly one <code v-pre>{{ path }}</code> sends the value itself, `null` when missing). A non-2xx answer fails the step, a header value that renders with a line break is refused, and errors show the URL template without its query. |
| `handoff` | Hands the chat to a human (`ctx.handoff`), with an optional message. |
| `ai` | One AI turn through `ctx.tools.ai.replyInChat`, optionally restricted to tool ids (`tools: ['lookup']`); stores the answer in `stateKey`. |

Media URLs must use http(s). Local paths, buffers and streams are deliberately **not** representable: a stored document cannot read the server's filesystem. The same holds at run time for `{ stateKey }` sources: the value in state can come from an end user's answer or an `http` response, so anything that is not an absolute http(s) URL (`/etc/passwd`, `C:\…`, `file:`, `data:`) fails the step instead of reaching the provider, which would read a plain string as a local file. The provider, or a self-hosted gateway such as Evolution or WPPConnect, downloads that URL from inside your network, so by default it must also be `https:` and its host must not be, or resolve to, a private, loopback or link-local address (`127.0.0.1`, `169.254.169.254`, `10.x`, `localhost`…). The `media` compile option relaxes this on purpose: `compileFlowDocument(doc, { media: { allowHttp: true, allowPrivateHosts: true, resolver } })`. URLs written in the document itself are the author's and are not checked.

A form field `pattern` runs against untrusted answers, so the validator rejects backreferences and repeated groups whose body repeats or alternates again (`(a+)+`, `(\w+\s?)*`, `(a|aa)+`: catastrophic backtracking). Write them with a character class instead (`[a-z0-9-]+`). That check is only a first filter: the compiled field never runs the pattern on JavaScript's backtracking engine. It matches the whole answer with a linear-time automaton (`O(answer length × pattern size)`), so adjacent quantifiers (`.*.*.*x`) or long alternation chains cannot freeze the process either. The supported syntax is the regular subset: literals and escapes, character classes, `.`, groups (capturing, `(?:…)` and named), `|`, `* + ? {n} {n,} {n,m}` (lazy forms accepted) and the anchors `^ $ \b \B`. Lookarounds (`(?=`, `(?!`, `(?<=`, `(?<!`), backreferences, octal escapes and patterns whose bounded repeats unroll to more than 2000 states are rejected. A text field with a `pattern` and no `maxLength` is capped at 500 characters, and its `maxLength` may be at most 1000 (`FLOW_DOCUMENT_LIMITS.maxPatternAnswerLength`): the automaton is linear, but its cost still grows with the answer length times the pattern size.

The validator also refuses form fields no answer can satisfy: `minLength` above `maxLength`, `min` above `max`, a `date` bound that is not a real day (`2025-02-30`) or a `min` after its `max`, and a `minSelected` above the number of options or above `maxSelected`.

## Safe expressions

`condition.if`, `guard.if` and `ask.validate.expr` use a tiny recursive-descent language:

- literals (`1`, `'text'`, `true`, `false`, `null`), state paths (`user.city`), `== != < <= > >= && || ! + -` and parentheses;
- functions: `len`, `lower`, `upper`, `trim`, `number`, `string`, `contains`, `startsWith`, `endsWith`, `empty`, `oneOf`.

No `eval`, no `Function`, no regexes, no indexing, no assignment, no prototype access (`__proto__`, `prototype`, `constructor` are rejected). Limits: 1000 characters, 256 tokens, 32 levels.

Templates (<code v-pre>{{ path }}</code>) only read own properties of `c.state` plus `$body`, `$from`, `$sender` and `$isGroup`; a missing value renders as an empty string. A rendered value is never read again as a template.

A state key may contain dots: after `ask` with `stateKey: 'user.name'`, both <code v-pre>{{ user.name }}</code> and `len(user.name)` read `c.state['user.name']` (a nested `c.state.user.name` object wins when both exist). Keys with `-` or `:` are valid ids but cannot be referenced (`first-name` is a subtraction), so use letters, digits, `_` and `.` for keys you read back. An unknown `$` variable, or `$answer` outside `ask.validate.expr`, is a validation issue.

## Validation errors

`validateFlowDocument()` returns JSON-pointer paths:

```ts
validateFlowDocument({ version: 2, id: 'x', trigger: 'x', steps: [{ kind: 'ask', text: '', stateKey: 'bad key' }] })
// [{ path: '/steps/0/text', message: '...' }, { path: '/steps/0/stateKey', message: '...' }]
```

`compileFlowDocument()` throws `FlowDocumentError` with the same issues. The JSON Schema (`FLOW_DOCUMENT_SCHEMA`, draft 2020-12) is served by the manager at `GET /v1/flows/schema` for editors and code generation.

## Subflows

```ts
bot.registerFlow(compileFlowDocument(parent, {
  resolveSubflow: (id) => documents.get(id),
}))
```

A subflow's steps run inline (same `c.state`, no second trigger). A missing document or a cycle (`a → b → a`) is a compile error. Because a subflow is inlined again at every reference, a flow may reach at most `FLOW_DOCUMENT_LIMITS.maxInlinedSteps` (5000) steps once all its subflows are expanded; a chain of flows that each call the next several times grows exponentially and is refused at compile time (in `@botmesh/manager`, `createBot`/`updateBot`/`addFlow` answer `INVALID`).

## Migrations

```ts
import { migrateFlowDocument } from '@botmesh/flow-schema'

const { document, from, applied } = migrateFlowDocument(storedDraft)
```

Version 0 (no `version`, the pre-versioned shape) becomes version 1. Version 1 becomes version 2: `retries` on `ask`/`form` steps meant the answers in total in v1, so `retries: N` is rewritten to `maxAttempts: N` (a `retries: 0` to `maxAttempts: 1`) and the flow keeps its behaviour; in v2 `retries` counts the answers after the first, like the core. `validateFlowDocument`, `compileFlowDocument` and `flowFromArtifact` apply that migration to v1 documents on load; `isFlowDocument` only accepts version 2. A version newer than the package is rejected; migrations can be extended and chained (`migrateFlowDocument(input, migrations, target)`).

## Reverse export

```ts
import { exportFlowDocument } from '@botmesh/flow-schema'

const document = exportFlowDocument(compiledFlow)
```

Flows compiled from a document round-trip exactly (the original JSON is kept as step metadata). Flows built with the DSL export their declarative steps (`say`, `ask`, `choose`, `goto`, `delay`, `media`, `form`, `use`); an opaque `do` or a function-based guard raises `FlowExportError` with the step paths instead of being dropped. So does a result that `validateFlowDocument` would refuse (a DSL `.delay()` longer than 5 minutes, an id with spaces): an export always loads again. The returned document is a copy; changing it does not touch the compiled flow.

## Drafts and deployments

```ts
import { diffFlowDocuments, flowDigest, publishFlow } from '@botmesh/flow-schema'

const changes = diffFlowDocuments(draft, published)   // metadata, added/removed/changed steps with paths
const digest = flowDigest(draft)                      // sha256 of canonical JSON, stable across key order
await publishFlow(registry, 'acme', 'support', draft) // DeploymentRegistry gate + audited gate run
```

`publishFlow()` uses the document JSON as the artifact and a `flowDocumentGate()` that parses, validates and compiles the candidate; `options.gate` can chain another gate (e.g. golden transcripts). `@botmesh/deployments` owns the storage; this package only provides the pure helpers. `@botmesh/deployments` is private (not on npm) and its API may change; see [Packages and versions](./packages#private-packages-9).

## Manager REST

::: warning Experimental: private package
`@botmesh/manager` is private (not on npm) and its API may change. See [Control plane](./control-plane).
:::

The manager's `POST`/`PUT` flow endpoints accept exactly these documents. `GET /v1/flows/schema` serves the JSON Schema and `GET/PUT/DELETE /v1/bots/{botId}/flows/{flowId}` store and hot-swap them without changing the REST contract. `subflow` steps resolve against the bot's other stored flows.
