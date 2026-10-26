/**
 * Entry layout of `@botmesh/flow-schema` (public, semver on the main entry): the main entry
 * holds what an application needs to validate, compile, export, migrate and publish flow
 * documents; the expression engine, the step-source metadata and the small helpers the
 * compiler and `@botmesh/manager` share live in `@botmesh/flow-schema/internal` (no semver).
 * Runtime names of both entries are pinned so growing them is a deliberate change.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = [
  'EXPRESSION_LIMITS', 'ExpressionError', 'FLOW_DOCUMENT_LIMITS', 'FLOW_DOCUMENT_SCHEMA', 'FLOW_DOCUMENT_SCHEMA_ID',
  'FLOW_DOCUMENT_VERSION', 'FLOW_ID_PATTERN', 'FLOW_MIGRATIONS', 'FlowDocumentError', 'FlowExportError', 'FlowMigrationError',
  'compileFlowDocument', 'diffFlowDocuments', 'exportFlowDocument', 'flowArtifact', 'flowDigest', 'flowDocumentGate',
  'flowFromArtifact', 'flowVersionOf', 'isFlowDocument', 'migrateFlowDocument', 'publishFlow', 'sameFlow', 'validateFlowDocument',
]

const INTERNAL_VALUES = [
  'FLOW_DOCUMENT_LEGACY_VERSIONS', 'FLOW_DOCUMENT_SOURCE', 'FLOW_STEP_SOURCE', 'canonicalJson', 'evaluateCondition',
  'evaluateExpression', 'flowDocumentSource', 'flowIssuesOf', 'flowScope', 'flowStepSource', 'hasTemplate', 'parseExpression',
  'renderTemplate', 'resolvePath', 'toMs',
]

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  private?: boolean
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
}

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen)
}

describe('@botmesh/flow-schema entry layout', () => {
  it('the main entry exports exactly the application values', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES].sort())
  })

  it('/internal exports the expression engine and the compiler helpers', () => {
    expect(Object.keys(internal).sort()).toEqual([...INTERNAL_VALUES].sort())
  })

  it('package.json exposes ./internal next to the main entry and is publishable', () => {
    expect(pkg.private).toBeUndefined()
    expect(pkg.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
  })

  it('depends only on public packages, through workspace:^', () => {
    expect(pkg.dependencies).toEqual({ '@botmesh/core': 'workspace:^', '@botmesh/http': 'workspace:^' })
  })

  it('never imports @botmesh/core/internal (no semver): the interpreter hooks come from /spi', () => {
    for (const file of readdirSync(new URL('../src/', import.meta.url))) {
      if (!file.endsWith('.ts')) continue
      expect(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), file).not.toMatch(/['"]@botmesh\/core\/internal['"]/)
    }
  })

  it('exported data is deep-frozen', () => {
    for (const name of ['FLOW_DOCUMENT_SCHEMA', 'FLOW_DOCUMENT_LIMITS', 'EXPRESSION_LIMITS', 'FLOW_MIGRATIONS'] as const) {
      expect(isDeepFrozen(main[name]), name).toBe(true)
    }
  })
})
