/**
 * The "Multi-language bot" example (docs/examples/multi-language.md,
 * docs/es/ejemplos/multi-idioma.md) runs as written: its bot.js block, with the
 * WhatsApp transport left out, replays the page's simulator transcript line by line
 * (`--user ana --name Ana`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DevSession } from '../src/dev/index.js'
import { exampleModuleSource, exampleTranscripts, exampleWorkspace, replayTranscript } from '../../../test-utils/docs-example-sim.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const src = (p: string) => pathToFileURL(fileURLToPath(new URL('../src/' + p, import.meta.url))).href

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

describe.each(['docs/examples/multi-language.md', 'docs/es/ejemplos/multi-idioma.md'])('%s runs as documented', (page) => {
  it('replays the transcript on the page: detection, stored language, /lang and plurals', async () => {
    const md = await readFile(join(root, page), 'utf8')
    const ws = await exampleWorkspace()
    cleanup.push(ws.dispose)
    const url = await ws.write('bot.ts', exampleModuleSource(md, page, {
      imports: { '@botmesh/core': src('index.ts'), '@botmesh/baileys': null },
    }))
    const transcripts = exampleTranscripts(md)
    expect(transcripts).toHaveLength(1)
    const { expected, actual } = await replayTranscript(DevSession, url, transcripts[0]!, { name: 'Ana' })
    expect(actual).toBe(expected)
  }, 30_000)
})
