/**
 * The "Order tracking" example (docs/examples/order-tracking.md,
 * docs/es/ejemplos/seguimiento-pedidos.md) runs as written: its bot.js block, with the
 * WhatsApp transport left out, replays the page's simulator transcript line by line.
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

describe.each([
  { page: 'docs/examples/order-tracking.md', file: './orders.json' },
  { page: 'docs/es/ejemplos/seguimiento-pedidos.md', file: './pedidos.json' },
])('$page runs as documented', ({ page, file }) => {
  it('replays the transcript on the page, restart included', async () => {
    const md = await readFile(join(root, page), 'utf8')
    const ws = await exampleWorkspace()
    cleanup.push(ws.dispose)
    const url = await ws.write('bot.ts', exampleModuleSource(md, page, {
      imports: { '@botmesh/core': src('index.ts'), '@botmesh/baileys': null },
      // The store file goes to the temporary folder instead of the working directory.
      replace: [[`'${file}'`, JSON.stringify(join(ws.dir, 'store.json'))]],
    }))
    const transcripts = exampleTranscripts(md)
    expect(transcripts).toHaveLength(1)
    const { expected, actual } = await replayTranscript(DevSession, url, transcripts[0]!)
    expect(actual).toBe(expected)
  }, 30_000)
})
