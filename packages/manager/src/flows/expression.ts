/**
 * The safe expression language now lives in `@botmesh/flow-schema` (shared with the
 * flow store/compiler; the engine is on its `/internal` entry). This module keeps the
 * manager's import path stable.
 */

export { EXPRESSION_LIMITS, ExpressionError } from '@botmesh/flow-schema'
export {
  evaluateCondition,
  evaluateExpression,
  hasTemplate,
  parseExpression,
  renderTemplate,
  resolvePath,
} from '@botmesh/flow-schema/internal'
export type { ExpressionNode } from '@botmesh/flow-schema/internal'
