/**
 * The semver entries name every type their signatures use: `JsonValue` (the shape of
 * `SerializedMediaRef.data` and of the durability journal records) is a production type, not a
 * test-kit one, and the app-facing types of `MessageContext.supports()` and
 * `ConversationControlsBase.waitAny()` are importable without `@botmesh/core/internal`.
 * `pnpm api-check missing` enforces the general rule over the compiled `.d.ts`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = join(dirname(fileURLToPath(import.meta.url)), '../src')
const read = (file: string) => readFileSync(join(src, file), 'utf8')

/** Every name re-exported by `source` (`export { a, type B } from '...'`), plus local `export type X`. */
function exportedNames(source: string): string[] {
  const names: string[] = []
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim()
      if (name) names.push(name)
    }
  }
  for (const m of source.matchAll(/export\s+(?:type|interface|const|class)\s+(\w+)/g)) names.push(m[1]!)
  return names
}

/** The TSDoc right before `name` in an `export { … } from` list, or `''` when it has none. */
function exportDoc(source: string, name: string): string {
  const m = new RegExp(String.raw`(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\s*(?:type\s+)?\b${name}\b\s*,?\s*(?:\n|\})`).exec(source)
  return m?.[1] ?? ''
}

describe('semver entries', () => {
  it.each(['JsonValue', 'MessagingFeature', 'MessagingSupport', 'ResolvedWaitOptions'])(
    'the main entry exports %s without deprecating it', (name) => {
      const index = read('index.ts')
      expect(exportedNames(index)).toContain(name)
      expect(exportDoc(index, name)).not.toMatch(/@deprecated/)
    })

  it('the SPI exports JsonValue, the type of the journal records it defines', () => {
    expect(exportedNames(read('spi.ts'))).toContain('JsonValue')
  })

  it('JsonValue is not defined by the test kit', () => {
    expect(read('testing/transcripts/format.ts')).not.toMatch(/export type JsonValue\s*=/)
    for (const file of ['core/mediaRefs.ts', 'durability/types.ts']) {
      expect(read(file), file).not.toMatch(/from '\.\.\/testing\//)
    }
  })

  it('the deprecated Whitelist and ConversationFn aliases are the very types Bot and the runtime use', () => {
    const index = read('index.ts')
    expect(index).toMatch(/\bWhitelist,?\s*\}\s*from '\.\/gates\/accessList\.js'/)
    expect(index).toMatch(/\bConversationFn,?\s*\}\s*from '\.\/conversations\/ConversationRuntime\.js'/)
  })
})
