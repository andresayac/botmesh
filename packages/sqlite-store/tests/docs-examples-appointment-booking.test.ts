/**
 * The "Appointment booking" example (docs/examples/appointment-booking.md,
 * docs/es/ejemplos/reserva-citas.md) runs as written on a real SQLite file: its bot.js
 * block, with the WhatsApp transport left out, replays the page's simulator transcript
 * line by line. The transcript's `:reset` builds a fresh bot (and a fresh SQLiteStore on
 * the same file) from the factory, so the resumed flow is a real restart.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DevSession } from '@botmesh/core/dev'
import { exampleModuleSource, exampleTranscripts, exampleWorkspace, replayTranscript } from '../../../test-utils/docs-example-sim.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(import.meta.url)
const core = pathToFileURL(require.resolve('@botmesh/core')).href
const store = pathToFileURL(fileURLToPath(new URL('../src/index.ts', import.meta.url))).href

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

describe.each([
  { page: 'docs/examples/appointment-booking.md', file: './bookings.db' },
  { page: 'docs/es/ejemplos/reserva-citas.md', file: './citas.db' },
])('$page runs as documented', ({ page, file }) => {
  it('replays the transcript on the page: validation, form, restart and confirmation', async () => {
    const md = await readFile(join(root, page), 'utf8')
    const ws = await exampleWorkspace()
    cleanup.push(ws.dispose)
    const url = await ws.write('bot.ts', exampleModuleSource(md, page, {
      imports: { '@botmesh/core': core, '@botmesh/sqlite-store': store, '@botmesh/baileys': null },
      // The database goes to the temporary folder instead of the working directory.
      replace: [[`'${file}'`, JSON.stringify(join(ws.dir, 'bot.db'))]],
    }))
    const transcripts = exampleTranscripts(md)
    expect(transcripts).toHaveLength(1)
    const { expected, actual } = await replayTranscript(DevSession, url, transcripts[0]!)
    expect(actual).toBe(expected)
  }, 30_000)
})
