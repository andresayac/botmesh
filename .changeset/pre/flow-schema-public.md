---
'@botmesh/flow-schema': major
---

First public release of `@botmesh/flow-schema`: versioned, code-free JSON flow documents (validation with JSON Pointer issues, a draft 2020-12 JSON Schema, safe expressions, compilation to `CompiledFlow`, reverse export, migrations and deploy helpers).

- **API freeze (main entry: 59 names before, 43 after).** The main entry keeps what an application needs: `validateFlowDocument`, `isFlowDocument`, `compileFlowDocument`, `exportFlowDocument`, `migrateFlowDocument`, `FLOW_MIGRATIONS`, `flowDigest`, `flowVersionOf`, `diffFlowDocuments`, `sameFlow`, `flowArtifact`, `flowFromArtifact`, `flowDocumentGate`, `publishFlow`, the schema constants, the errors and their types. New `@botmesh/flow-schema/internal` entry (no semver) with the expression engine (`parseExpression`, `evaluateExpression`, `evaluateCondition`, `renderTemplate`, `resolvePath`, `hasTemplate`, `ExpressionNode`), the step-source metadata (`FLOW_STEP_SOURCE`, `FLOW_DOCUMENT_SOURCE`, `flowStepSource`, `flowDocumentSource`, `flowScope`) and small helpers (`toMs`, `canonicalJson`, `flowIssuesOf`, `FLOW_DOCUMENT_LEGACY_VERSIONS`).
- **Exported data is deep-frozen:** `FLOW_DOCUMENT_SCHEMA` and `FLOW_MIGRATIONS` (extend a copy: `[...FLOW_MIGRATIONS, mine]`).
- Nested `delay` and `form` steps use the semver hooks of `@botmesh/core/spi` instead of `@botmesh/core/internal`, so a newer core minor cannot break the compiled flows.
