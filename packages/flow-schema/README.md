# @botmesh/flow-schema

**Versioned, code-free flow documents** for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core): JSON that describes a conversation (questions, menus, conditions, media, forms, HTTP calls, handoff, an AI turn), validated against a JSON Schema and compiled to a core `CompiledFlow`. A document is data only: it cannot run code, read local files or reach private hosts, so it is safe to store, edit in a UI and hot-swap.

## Install

```bash
pnpm add @botmesh/core @botmesh/flow-schema
```

Node.js 22 or later, ESM only. It depends on `@botmesh/core` and [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http) (for the `http` step).

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

## Quick start

```ts
import { compileFlowDocument, validateFlowDocument, type FlowDocument } from '@botmesh/flow-schema'

const document: FlowDocument = {
  version: 2,
  id: 'checkout',
  trigger: { keywords: ['buy', 'order'], match: 'contains' },
  timeout: '5m',
  steps: [
    { kind: 'ask', text: 'Your name?', stateKey: 'name' },
    { kind: 'condition', if: 'len(name) > 2', then: [{ kind: 'say', text: 'Hi {{name}}' }] },
    { kind: 'handoff', reason: 'checkout' },
  ],
}

const issues = validateFlowDocument(document) // [{ path: '/steps/0/text', message: '...' }] when invalid
if (issues.length === 0) bot.registerFlow(compileFlowDocument(document))
```

`compileFlowDocument()` validates too and throws `FlowDocumentError` (with the same `issues`) on an invalid document.

## Steps

| Kind | What it does |
| --- | --- |
| `say` | Sends text (`{{ path }}` templates allowed). |
| `ask` | Asks and stores the answer in `c.state[stateKey]`; optional `timeout`, `maxAttempts` / `retries` and `validate: { expr, message }` (in scope there: `$answer`, `$body`, `$from`, `$sender`, `$isGroup`; not `c.state`). |
| `choose` | Numbered menu (`options: [{ key, label, steps? }]`), stores the picked key. |
| `condition` | `if` expression with `then` / `else` nested steps. |
| `delay` | Pauses (at most 5 minutes); ends with the conversation. |
| `goto` / `end` | Jumps to another flow / ends with an optional farewell. |
| `media` | Image, video, audio, voice, document, sticker (http(s) URL, or an https URL with a public host in state: anything else, such as a local path or `http://169.254.169.254/`, fails the step) or location. |
| `form` | Native form, or question by question where the channel has no forms. |
| `guard` | `if` expression; when false it sends `message` and ends or redirects. |
| `subflow` | Inlines another document, resolved with `resolveSubflow`. |
| `http` | Request through `@botmesh/http` (anti-SSRF, redirect checks, timeout, size cap); stores the body in `stateKey`. `{{ path }}` works in the URL path/query/fragment, header values and the JSON `body`; a non-2xx answer fails the step. |
| `handoff` | Hands the chat to a human (`ctx.handoff`). |
| `ai` | One AI turn through `ctx.tools.ai` (needs [`@botmesh/ai`](https://www.npmjs.com/package/@botmesh/ai)), optionally restricted to configured tool ids. |

Expressions (`condition.if`, `guard.if`, `ask.validate.expr`) are a small safe language: literals, state paths, comparisons, `&& || !`, `+ -` and the functions `len`, `lower`, `upper`, `trim`, `number`, `string`, `contains`, `startsWith`, `endsWith`, `empty`, `oneOf`. No `eval`, `Function`, regexes, indexing or prototype access.

## API

| Export | What it is for |
| --- | --- |
| `validateFlowDocument(input)` / `isFlowDocument(input)` | Issues with JSON Pointer paths / type guard (version 2 only). A version 1 document is migrated on load. |
| `compileFlowDocument(input, options?)` | Document → `CompiledFlow`. Options below. |
| `exportFlowDocument(flow)` | `CompiledFlow` → document. Exact for flows compiled from a document; an opaque `do`, or a result that would not validate, throws `FlowExportError`. |
| `migrateFlowDocument(input, migrations?, target?)` | Chains `FLOW_MIGRATIONS` (frozen; extend a copy). |
| `flowDigest`, `flowVersionOf`, `diffFlowDocuments`, `sameFlow` | `sha256` over canonical JSON, a version label, a structural diff, equality ignoring key order. |
| `flowArtifact`, `flowFromArtifact`, `flowDocumentGate`, `publishFlow` | Store a document as a deployment artifact and gate it (any registry with a compatible `publish()`). |
| `FLOW_DOCUMENT_SCHEMA`, `FLOW_DOCUMENT_LIMITS`, `FLOW_DOCUMENT_VERSION`, `FLOW_ID_PATTERN` | The draft 2020-12 JSON Schema (deep-frozen) and its limits, for editors and code generation. |

`@botmesh/flow-schema/internal` holds the expression engine and the compiler's metadata helpers. It has **no semver guarantee**.

## Compile options

| Option | Default | What it does |
| --- | --- | --- |
| `resolveSubflow` | none | `(id) => FlowDocument \| undefined` for `subflow` steps. A missing document or a cycle is a compile error. |
| `fetch` | `secureFetch` | Custom fetch for `http` steps (tests, an egress proxy), with the signature of `@botmesh/http`'s `secureFetch`. |
| `http` | 10 s, 64 KiB | Bounds of `http` steps: `{ timeoutMs, maxBytes, allowHttp }`. |
| `media` | https, public hosts | Policy for `media` URLs read from state: `{ allowHttp, allowPrivateHosts, resolver }`. |
| `formTimeoutMs` | the form's own option | Timeout of the waits of a nested `form` step. |

## Troubleshooting

- **`FlowDocumentError` on compile:** read `error.issues`; each one has the JSON Pointer of the offending node (`/steps/2/stateKey`).
- **`unknown function` / `ExpressionError`:** only the functions listed above exist, and paths read own properties of `c.state` (plus `$body`, `$from`, `$sender`, `$isGroup`).
- **A form `pattern` is rejected:** patterns that can backtrack catastrophically (`(a+)+`, backreferences, lookarounds) are refused; write them with a character class (`[a-z0-9-]+`). A field with a pattern accepts answers of at most 1000 characters (`maxLength`).
- **`{{ first-name }}` renders literally:** state keys you read back must use letters, digits, `_` and `.` (a dotted key such as `user.name` works).
- **`"name" is not available here` on `ask.validate.expr`:** the answer is validated before it is stored, so only `$answer` and the message fields exist there.
- **`http` step refused:** placeholders are allowed only in the URL path, query or fragment, never in the host; plain `http:` needs `http: { allowHttp: true }`, and private or loopback hosts are always refused by `@botmesh/http`.
- **`media` step from state refused:** a URL read from `c.state` must be `https:` (or `http:` with `media: { allowHttp: true }`) and its host must resolve to public addresses (`media: { allowPrivateHosts: true }` lifts that for internal media servers).

## Links

- [JSON flow schema guide](https://botmesh.afaya.com.co/guide/flow-schema) · [Forms](https://botmesh.afaya.com.co/guide/forms) · [MCP server for flow documents](https://www.npmjs.com/package/@botmesh/mcp)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/flow-schema/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/flow-schema) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver (except `@botmesh/flow-schema/internal`).
