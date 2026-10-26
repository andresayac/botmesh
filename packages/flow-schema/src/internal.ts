/**
 * `@botmesh/flow-schema/internal` — helpers shared by the compiler, `@botmesh/manager` and the
 * tests: the safe expression engine (parser, evaluator, template renderer and its AST), the
 * step-source metadata the reverse export reads, and small document utilities.
 *
 * **No semver guarantee**: anything here can change in a minor or patch release. Applications
 * use the main entry (`@botmesh/flow-schema`); documents use the expression language through
 * `condition.if`, `guard.if`, `ask.validate.expr` and `{{ path }}` templates.
 *
 * @module @botmesh/flow-schema/internal
 */

export { FLOW_DOCUMENT_LEGACY_VERSIONS, toMs } from './schema.js'

export { evaluateCondition, evaluateExpression, hasTemplate, parseExpression, renderTemplate, resolvePath } from './expression.js'
export type { ExpressionNode } from './expression.js'

export { FLOW_DOCUMENT_SOURCE, FLOW_STEP_SOURCE, flowDocumentSource, flowScope, flowStepSource } from './compile.js'

export { canonicalJson, flowIssuesOf } from './deployments.js'
