/**
 * create-botmesh — programmatic API of the project scaffolder
 * (the CLI bin in `cli.js` wraps these). The template table, the AGENTS.md renderer
 * and the monorepo probe live in `create-botmesh/internal` (no semver).
 */

export { scaffold, sanitizeName } from './scaffold.js'
export type { ScaffoldOptions, ScaffoldResult } from './scaffold.js'
export { TEMPLATE_NAMES, getTemplate } from './templates.js'
export type { TemplateName, TemplateFile, ProjectTemplate } from './templates.js'

// Scaffolder internals: deprecated here; they live in 'create-botmesh/internal'.
export {
  /** @deprecated Use `getTemplate(name)` and `TEMPLATE_NAMES`; the table is in 'create-botmesh/internal' (no semver). */
  TEMPLATES,
  /** @deprecated Import from 'create-botmesh/internal' (no semver): `scaffold()` already writes AGENTS.md. */
  agentsMd,
  /** @deprecated Import from 'create-botmesh/internal' (no semver): `scaffold()` already runs this check. */
  findBotMeshMonorepo,
} from './internal.js'
export type {
  /** @deprecated Import from 'create-botmesh/internal' (no semver). */
  AgentsMdInfo,
} from './internal.js'
