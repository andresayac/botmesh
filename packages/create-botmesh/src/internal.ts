/**
 * create-botmesh/internal — building blocks of the scaffolder that the CLI and the
 * repo's own scripts use: the template table, the AGENTS.md renderer and the monorepo
 * probe. No semver promise: they can change in any release. Use the main entry
 * (`scaffold`, `getTemplate`, `TEMPLATE_NAMES`) to build tooling on top of it.
 */

export { TEMPLATES } from './templates.js'
export { agentsMd } from './agentsMd.js'
export type { AgentsMdInfo } from './agentsMd.js'
export { findBotMeshMonorepo } from './scaffold.js'
