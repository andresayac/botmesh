/**
 * The "Group bot" example (docs/examples/group-bot.md, docs/es/ejemplos/bot-de-grupo.md)
 * runs as written: its bot.js block, with the WhatsApp transport left out, replays the
 * page's group transcript, and the `groupMode: 'mentions'` variation the page shows
 * (the same bot with that one option) replays the second transcript.
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
  { page: 'docs/examples/group-bot.md', config: 'new Bot({ provider })', mentions: "new Bot({ provider, groupMode: 'mentions' })" },
  { page: 'docs/es/ejemplos/bot-de-grupo.md', config: "new Bot({ provider, lang: 'es' })", mentions: "new Bot({ provider, lang: 'es', groupMode: 'mentions' })" },
])('$page runs as documented', ({ page, config, mentions }) => {
  it('replays both transcripts: the default group mode and the mentions variation', async () => {
    const md = await readFile(join(root, page), 'utf8')
    // The variation's snippet is the exact config the second transcript runs with.
    expect(md.replace(/\r\n/g, '\n')).toContain('```js\nconst bot = ' + mentions + '\n```')
    const ws = await exampleWorkspace()
    cleanup.push(ws.dispose)
    const imports = { '@botmesh/core': src('index.ts'), '@botmesh/baileys': null }
    const plain = await ws.write('bot.ts', exampleModuleSource(md, page, { imports }))
    const variation = await ws.write('bot-mentions.ts', exampleModuleSource(md, page, { imports, replace: [[config, mentions]] }))
    const transcripts = exampleTranscripts(md)
    expect(transcripts).toHaveLength(2)
    for (const [i, url] of [plain, variation].entries()) {
      const { expected, actual } = await replayTranscript(DevSession, url, transcripts[i]!, { name: 'Ana' })
      expect(actual).toBe(expected)
    }
  }, 30_000)
})
