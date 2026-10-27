# @botmesh/flow-schema

## 1.0.0-beta.0

### Major Changes

- 7e9c369: First public release of `@botmesh/flow-schema`: versioned, code-free JSON flow documents (validation with JSON Pointer issues, a draft 2020-12 JSON Schema, safe expressions, compilation to `CompiledFlow`, reverse export, migrations and deploy helpers).
  
  - **API freeze (main entry: 59 names before, 43 after).** The main entry keeps what an application needs: `validateFlowDocument`, `isFlowDocument`, `compileFlowDocument`, `exportFlowDocument`, `migrateFlowDocument`, `FLOW_MIGRATIONS`, `flowDigest`, `flowVersionOf`, `diffFlowDocuments`, `sameFlow`, `flowArtifact`, `flowFromArtifact`, `flowDocumentGate`, `publishFlow`, the schema constants, the errors and their types. New `@botmesh/flow-schema/internal` entry (no semver) with the expression engine (`parseExpression`, `evaluateExpression`, `evaluateCondition`, `renderTemplate`, `resolvePath`, `hasTemplate`, `ExpressionNode`), the step-source metadata (`FLOW_STEP_SOURCE`, `FLOW_DOCUMENT_SOURCE`, `flowStepSource`, `flowDocumentSource`, `flowScope`) and small helpers (`toMs`, `canonicalJson`, `flowIssuesOf`, `FLOW_DOCUMENT_LEGACY_VERSIONS`).
  - **Exported data is deep-frozen:** `FLOW_DOCUMENT_SCHEMA` and `FLOW_MIGRATIONS` (extend a copy: `[...FLOW_MIGRATIONS, mine]`).
  - Nested `delay` and `form` steps use the semver hooks of `@botmesh/core/spi` instead of `@botmesh/core/internal`, so a newer core minor cannot break the compiled flows.

### Patch Changes

- cd0ea7b: Release-test hardening of flow documents (documents and their end users can no longer reach local files, and mistakes fail with clear messages):
  
  - **Media from `c.state` must be an absolute http(s) URL.** A `media` step with `source: { stateKey }` passed the stored value to the provider as is; since that value can be an end user's answer or an `http` response, an answer such as `/etc/passwd` or `C:\...\creds.json` made Baileys, the Cloud API or Telegram read and send a local file (and Baileys streams a non-http `{ url }` from disk). Anything that is not an http(s) URL now fails the step, without the value in the error. The provider or a self-hosted gateway (Evolution, WPPConnect) downloads that URL from inside the operator's network, so it must also be `https:` and its host must not be or resolve to a private, loopback or link-local address (`http://169.254.169.254/...`, `http://127.0.0.1:8080/admin`); the new `media: { allowHttp, allowPrivateHosts, resolver }` compile option (`FlowMediaPolicy`) relaxes this on purpose.
  - **`http` step:** a non-2xx answer fails the step instead of being stored as data; a header value that renders with a line break is refused; errors (and so logs) show the URL template without credentials, query or fragment, never the rendered URL with user values or `?api_key=` secrets. String values of the JSON `body` now accept `{{ path }}` placeholders (a string that is exactly one placeholder sends the value itself).
  - **Validator parity with `FLOW_DOCUMENT_SCHEMA`:** select options (1-20, labels up to 200 characters), location `name`/`address` lengths, form field properties whatever the field type and a media source with both `url` and `stateKey` are checked like the JSON Schema; lengths count characters (code points), as JSON Schema does, so emoji no longer count twice.
  - **Clear errors for impossible documents:** form fields no answer can satisfy (`minLength` > `maxLength`, `min` > `max`, a date that does not exist or a `min` after `max`, `minSelected` above the options or `maxSelected`); state paths in `ask.validate.expr` (only `$answer`, `$body`, `$from`, `$sender`, `$isGroup` exist there); `$answer` outside it and unknown `$` variables; invalid `compileFlowDocument` options (`http.timeoutMs`, `http.maxBytes`, `formTimeoutMs`).
  - **Form patterns:** a text field with a `pattern` accepts answers of at most 1000 characters (`FLOW_DOCUMENT_LIMITS.maxPatternAnswerLength`): the linear matcher costs answer length × pattern size, and a large `maxLength` let one answer block the event loop for seconds.
  - **Dotted state keys:** `{{ user.name }}` and `len(user.name)` read `c.state['user.name']` written by `ask` with `stateKey: 'user.name'` (a nested object still wins).
  - **`exportFlowDocument`** returns a copy (changing it no longer alters the compiled flow's metadata or a later export) and throws `FlowExportError` for a result `validateFlowDocument` would refuse (for example a DSL `.delay()` longer than 5 minutes).
- Updated dependencies [8d86135]
- Updated dependencies [618502b]
- Updated dependencies [7e9c369]
- Updated dependencies [c361ba3]
  - @botmesh/core@2.0.0-beta.4
