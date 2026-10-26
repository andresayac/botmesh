/**
 * Example "Testing your bot" (docs/examples/testing-your-bot.md,
 * docs/es/ejemplos/probar-tu-bot.md). The page ships two files a user copies:
 * bot.js and tests/bot.test.js. This suite writes both to a temporary project and
 * imports the test file while collecting, so the page's own Vitest tests run here as
 * written (they record the golden transcript, then replay it). It also checks the
 * golden file and the simulator transcript the page shows.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createDocsProject, extractFile, readPage, simulate, transcriptBlock, type DocsProject } from '../../../test-utils/docs-examples.js'
import { DevSession } from '../src/dev/index.js'

const PAGES = [
  { page: 'docs/examples/testing-your-bot.md', golden: 'tests/golden/order.json', lines: ['hi', 'order', 'hawaiian', 'Pepperoni', 'lots', '2', '/ping'] },
  { page: 'docs/es/ejemplos/probar-tu-bot.md', golden: 'tests/golden/pedido.json', lines: ['hola', 'pedido', 'hawaiana', 'Pepperoni', 'muchas', '2', '/ping'] },
]

// The page's test file imports its runner API from 'vitest': hand it this file's.
const VITEST_GLOBAL = '__botmeshDocsVitest'
;(globalThis as Record<string, unknown>)[VITEST_GLOBAL] = { afterAll, afterEach, beforeEach, describe, expect, it, test, vi }

function useThisVitest(code: string): string {
  return code.replace(/import\s*(\{[^}]*\})\s*from\s*'vitest'/, `const $1 = globalThis.${VITEST_GLOBAL}`)
}

async function project(page: string): Promise<DocsProject> {
  const md = readPage(page)
  return createDocsProject(
    { 'bot.js': extractFile(md, 'bot.js'), 'tests/bot.test.js': useThisVitest(extractFile(md, 'tests/bot.test.js')) },
    { fromSource: ['@botmesh/core'], stubs: { '@botmesh/baileys': 'export class BaileysProvider {}' } },
  )
}

for (const { page, golden: goldenFile, lines } of PAGES) {
  describe(`${page}: the page's tests/bot.test.js`, async () => {
    const p = await project(page)
    afterAll(() => p.remove())
    await p.import('tests/bot.test.js')

    test('wrote the golden transcript the page shows (its first turns)', () => {
      const golden = JSON.parse(readFileSync(p.path(goldenFile), 'utf8')) as { turns: unknown[] }
      const block = /```json\n([\s\S]*?)```/.exec(readPage(page))?.[1]
      expect(block, 'the page shows an excerpt of ' + goldenFile).toBeTruthy()
      const shown = JSON.parse(block!) as { turns: unknown[] }
      expect(shown.turns.length).toBeGreaterThan(0)
      expect({ ...golden, turns: golden.turns.slice(0, shown.turns.length) }).toEqual(shown)
    })
  })

  describe(page, () => {
    it('prints the sample transcript in the terminal simulator', async () => {
      const p = await project(page)
      try {
        const out = await simulate(DevSession, () => p.import('bot.js'), lines)
        expect(out).toBe(transcriptBlock(readPage(page)))
      } finally {
        await p.remove()
      }
    })
  })
}
