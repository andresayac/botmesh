/**
 * Entry layout of `@botmesh/ai` (see docs/release-readiness.md, "API freeze"): the main entry
 * holds what an application needs; test doubles live in `/testing` (semver) and the plugin's
 * helpers and the SDK wire shapes in `/internal` (no semver). The runtime names of each entry
 * are pinned here so that growing one is a deliberate change. Types are checked by
 * `pnpm api-check`.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'
import * as testing from '../src/testing.js'

/** Every runtime (value) export of the main entry. */
const MAIN_VALUES = [
  'AIClient', 'AITimeoutError', 'AIToolCancelledError', 'AI_LOCALES', 'AI_MESSAGES', 'AnthropicProvider', 'ContextManager',
  'DEFAULT_NO', 'DEFAULT_YES', 'GeminiProvider', 'LazyProvider', 'MemoryManager', 'OllamaProvider', 'OpenAIProvider',
  'PRESETS', 'aiPlugin', 'anthropicModelSupport', 'argLines', 'chatKeyOf', 'classifyConfirmation', 'confirmWith',
  'defineTool', 'formatMarkdown', 'formatMarkdownStream', 'fromGoogleGenAI', 'isPreset', 'resolveProvider', 'runToolLoop',
  'summarizeValue',
] as const

/** Deprecated re-exports kept on the main entry for alpha users (their home is `/testing`). */
const MAIN_DEPRECATED_VALUES = ['MockAIProvider'] as const

/** Runtime exports of `/testing`. */
const TESTING_VALUES = ['MockAIProvider', 'validateArgs'] as const

/** Plugin helpers moved from the main entry to `/internal` (no deprecated alias: never documented). */
const MOVED_TO_INTERNAL = [
  'aiText', 'defaultConfirmPrompt', 'DEFAULT_MAX_STEPS', 'DEFAULT_TOOL_TIMEOUT_MS', 'toolDefinitions', 'parametersOf',
  'isAffirmative', 'humanizeName', 'toolTitle', 'ToolLedger', 'stableKey', 'DEFAULT_DEDUPE_WINDOW_MS',
  'DEFAULT_LEDGER_RETENTION_MS', 'toGeminiSchema', 'DEFAULT_MEMORY_NAMESPACE', 'factsSchema', 'parseFacts',
  'DEFAULT_RAG_INSTRUCTIONS', 'ragContextBlock', 'citedChunks', 'citedPassages', 'formatSources',
] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/ai entry layout', () => {
  it('the main entry exports exactly the application values (plus the deprecated re-exports)', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('/testing exports the test doubles, and the deprecated main alias is the same class', () => {
    expect(keysOf(testing)).toEqual([...TESTING_VALUES].sort())
    expect(main.MockAIProvider).toBe(testing.MockAIProvider)
  })

  it('the moved helpers are reachable from /internal only', () => {
    for (const name of MOVED_TO_INTERNAL) {
      expect(internal[name as keyof typeof internal], name).toBeDefined()
      expect((main as Record<string, unknown>)[name], name).toBeUndefined()
    }
  })

  it('no test double lives in /internal', () => {
    expect((internal as Record<string, unknown>).MockAIProvider).toBeUndefined()
  })
})

describe('@botmesh/ai exported data is frozen', () => {
  const deepFrozen = (v: unknown, path: string): void => {
    if (typeof v !== 'object' || v === null) return
    expect(Object.isFrozen(v), path).toBe(true)
    for (const [k, child] of Object.entries(v)) deepFrozen(child, `${path}.${k}`)
  }

  it.each([
    ['AI_MESSAGES', main.AI_MESSAGES],
    ['AI_LOCALES', main.AI_LOCALES],
    ['PRESETS', main.PRESETS],
    ['DEFAULT_YES', main.DEFAULT_YES],
    ['DEFAULT_NO', main.DEFAULT_NO],
  ])('%s cannot be mutated by a user', (name, value) => {
    deepFrozen(value, name)
  })

  it('a write to a frozen export throws in strict mode and changes nothing', () => {
    expect(() => { (main.DEFAULT_YES as string[]).push('arre') }).toThrow(TypeError)
    expect(() => { (main.PRESETS.kimi as { model: string }).model = 'x' }).toThrow(TypeError)
    expect(main.DEFAULT_YES).not.toContain('arre')
    expect(main.PRESETS.kimi.model).not.toBe('x')
  })

  it('isPreset only accepts own preset names (not inherited keys)', () => {
    expect(main.isPreset('kimi')).toBe(true)
    expect(main.isPreset('toString')).toBe(false)
    expect(main.isPreset('__proto__')).toBe(false)
  })

  it('extending a vocabulary still works by copying', () => {
    expect(main.classifyConfirmation('arre', { yes: [...main.DEFAULT_YES, 'arre'] })).toBe('approved')
  })
})

describe('the repo imports moved names from their new entry', () => {
  it('no guide, README, example or package imports a moved helper or a test double from the main entry', { timeout: 30_000 }, async () => {
    const { lstatSync, readFileSync, readdirSync } = await import('node:fs')
    const { join, resolve } = await import('node:path')
    const root = resolve(import.meta.dirname, '../../..')
    const ownDirs = new Set([resolve(root, 'packages/ai/src'), resolve(root, 'packages/ai/tests')])
    const roots = ['docs/guide', 'docs/es/guide', 'docs/examples', 'docs/es/ejemplos', 'docs/public', 'examples', 'packages', 'scripts']
    const skipNames = new Set(['node_modules', 'lib', 'dist', 'coverage', 'sessions', '.vitepress', 'CHANGELOG.md'])
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (skipNames.has(name) || name.endsWith('_sessions') || ownDirs.has(p)) continue
        const st = lstatSync(p)
        if (st.isDirectory()) walk(p)
        else if (st.isFile() && /\.(ts|mts|js|mjs|md|txt)$/.test(name)) files.push(p)
      }
    }
    for (const r of roots) walk(join(root, r))
    const banned = new Set<string>([...MOVED_TO_INTERNAL, ...MAIN_DEPRECATED_VALUES, 'validateArgs', 'MockOptions', 'MockTurn'])
    const offenders: string[] = []
    const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@botmesh\/ai['"]|import\(['"]@botmesh\/ai['"]\)/g
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(importRe)) {
        if (!m[1]) { if (/MockAIProvider/.test(text.slice(m.index! - 80, m.index!))) offenders.push(`${f}: dynamic import`); continue }
        for (const raw of m[1].split(',')) {
          const name = raw.replace(/\btype\b/, '').split(/\bas\b/)[0]!.trim()
          if (banned.has(name)) offenders.push(`${f}: ${name}`)
        }
      }
    }
    // pack-smoke imports the deprecated alias on purpose, to check it is the same class.
    expect(offenders.filter((o) => !/pack-smoke\.mjs: MockAIProvider$/.test(o))).toEqual([])
  })
})
