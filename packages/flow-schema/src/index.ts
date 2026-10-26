/**
 * @botmesh/flow-schema — versioned, code-free JSON flows for botmesh.
 *
 * - **Validation**: {@link validateFlowDocument} / {@link isFlowDocument} and the
 *   JSON Schema itself ({@link FLOW_DOCUMENT_SCHEMA}, draft 2020-12), with precise
 *   JSON-pointer issues and structural limits.
 * - **Safe expressions** inside documents (`condition.if`, `guard.if`, `ask.validate.expr`,
 *   `{{ path }}` templates): no `eval`, no `Function`, no regexes, no property access beyond
 *   plain own-property paths. The engine itself lives in `@botmesh/flow-schema/internal`.
 * - **Compilation**: {@link compileFlowDocument} turns a document into a core
 *   `CompiledFlow` (`say`, `ask`, `choose`, `delay`, `goto`, `end`, `condition`, `media`,
 *   `form`, `guard`, `subflow`, `http`, `handoff` and an `ai` step with tools by id).
 * - **Reverse export**: {@link exportFlowDocument} turns an introspectable
 *   `CompiledFlow` back into JSON (exact for flows compiled from a document).
 * - **Migrations**: {@link migrateFlowDocument} chains version upgrades.
 * - **Deployments**: {@link flowDigest}, {@link diffFlowDocuments},
 *   {@link flowDocumentGate} and {@link publishFlow} (the optional integration with
 *   `@botmesh/deployments`).
 *
 * @example
 * ```ts
 * import { compileFlowDocument, validateFlowDocument } from '@botmesh/flow-schema'
 *
 * const document = {
 *   version: 2 as const, id: 'survey', trigger: 'survey',
 *   steps: [
 *     { kind: 'ask' as const, text: 'Your name?', stateKey: 'name' },
 *     { kind: 'say' as const, text: 'Thanks {{name}}' },
 *   ],
 * }
 * if (validateFlowDocument(document).length === 0) bot.registerFlow(compileFlowDocument(document))
 * ```
 */

export {
  FLOW_DOCUMENT_VERSION,
  FLOW_DOCUMENT_SCHEMA_ID,
  FLOW_DOCUMENT_SCHEMA,
  FLOW_DOCUMENT_LIMITS,
  FLOW_ID_PATTERN,
  FlowDocumentError,
  isFlowDocument,
  validateFlowDocument,
} from './schema.js'
export type {
  FlowDocument,
  FlowDocumentIssue,
  FlowDocumentTrigger,
  FlowDuration,
  FlowFormDocument,
  FlowFormFieldDocument,
  FlowMediaDocumentKind,
  FlowMediaDocumentSource,
  FlowStepDocument,
} from './schema.js'

export { EXPRESSION_LIMITS, ExpressionError } from './expression.js'

export { compileFlowDocument } from './compile.js'
export type { CompileFlowOptions, FlowMediaPolicy } from './compile.js'

export { FlowExportError, exportFlowDocument } from './introspect.js'

export { FLOW_MIGRATIONS, FlowMigrationError, migrateFlowDocument } from './migrate.js'
export type { FlowMigration, MigrationResult } from './migrate.js'

export {
  diffFlowDocuments,
  flowArtifact,
  flowDigest,
  flowDocumentGate,
  flowFromArtifact,
  flowVersionOf,
  publishFlow,
  sameFlow,
} from './deployments.js'
export type {
  FlowDifference,
  FlowDocumentDiff,
  PublishFlowOptions,
  FlowDeploymentCandidate,
  FlowGateResult,
  FlowDeploymentGate,
  FlowDeploymentRegistry,
} from './deployments.js'
