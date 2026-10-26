/**
 * The "Human handoff" example (docs/examples/human-handoff.md,
 * docs/es/ejemplos/handoff-humano.md) runs as written: its bot.js block, with the
 * WhatsApp transport left out, replays the page's simulator transcript line by line,
 * and the inactivity timeout gives the chat back to the bot.
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

const PAGES = [
  { page: 'docs/examples/human-handoff.md', ask: 'human', back: '⏰ No one is free right now' },
  { page: 'docs/es/ejemplos/handoff-humano.md', ask: 'humano', back: '⏰ Ahora mismo no hay nadie libre' },
]

async function moduleFor(page: string, replace: Array<[string, string]> = []): Promise<{ md: string; url: string }> {
  const md = await readFile(join(root, page), 'utf8')
  const ws = await exampleWorkspace()
  cleanup.push(ws.dispose)
  const url = await ws.write('bot.ts', exampleModuleSource(md, page, {
    imports: { '@botmesh/core': src('index.ts'), '@botmesh/baileys': null },
    replace,
  }))
  return { md, url }
}

describe.each(PAGES)('$page runs as documented', ({ page, ask, back }) => {
  it('replays the transcript on the page: handoff, relay, agent reply, /done and /bot', async () => {
    const { md, url } = await moduleFor(page)
    const transcripts = exampleTranscripts(md)
    expect(transcripts).toHaveLength(1)
    const { expected, actual } = await replayTranscript(DevSession, url, transcripts[0]!)
    expect(actual).toBe(expected)
  }, 30_000)

  it('gives the chat back to the bot when no agent answers in time', async () => {
    // The page waits 10 minutes; the test shortens only that constant.
    const { url } = await moduleFor(page, [["const AGENT_TIMEOUT = '10m'", "const AGENT_TIMEOUT = '300ms'"]])
    let printed = ''
    const session = new DevSession({ load: () => import(url), write: (t) => { printed += t }, user: 'ana', echo: true, settleMs: 50 })
    expect(await session.start()).toBe(true)
    try {
      await session.handleLine(ask)
      expect(session.bot!.isHandedOff('ana')).toBe(true)
      await new Promise((r) => setTimeout(r, 700))
      await session.drain()
      expect(session.bot!.isHandedOff('ana')).toBe(false)
      expect(printed).toContain(back)
    } finally {
      await session.stop()
    }
  }, 30_000)
})
