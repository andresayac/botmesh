/**
 * A `.persistent()` flow that opens with `.ask()` survives a process restart while it
 * waits for that first answer: the bot checkpoints the flow when it starts (step 0), not
 * only after the first completed step. Restart = a new SQLiteStore over the same file.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { flow } from '@botmesh/core'
import { createTestBot } from '@botmesh/core/testing'
import { SQLiteStore } from '../src/SQLiteStore.js'

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })

const survey = () => flow('survey').persistent()
  .ask('Your name?', 'name')
  .say((_ctx, c) => `Thanks ${String(c.state.name)}`)

describe('persistent flow + SQLiteStore restart', () => {
  it('resumes a flow restarted while its first ask waits', async () => {
    dir = mkdtempSync(join(tmpdir(), 'botwa-sqlite-persist-'))
    const file = join(dir, 'bot.db')

    const first = await createTestBot({ store: new SQLiteStore({ file }) })
    first.bot.use(survey())
    await first.chat.send('survey')
    await first.chat.expectReply('Your name?')
    await first.bot.stop()                          // "crash" while the first ask waits

    const store = new SQLiteStore({ file })
    const second = await createTestBot({ store })   // same file = restart
    second.bot.use(survey())
    expect(await store.listCheckpoints()).toHaveLength(1)
    await second.chat.send('hello?')                // wakes the dormant checkpoint
    await second.chat.expectReply('Your name?')     // the pending ask is asked again
    await second.chat.send('Ana')
    await second.chat.expectReply('Thanks Ana')
    await second.bot.stop()
  })
})
