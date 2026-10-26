/**
 * Event journals: a corrupt line in the MIDDLE of the append log is refused with a clear
 * error (`code: 'APPEND_LOG_CORRUPT'`) instead of being cut as a torn tail (which silently
 * dropped every later entry); a torn LAST line is still cut. `fsync: true` flushes snapshots.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileEventJournal, SharedFileEventJournal, createEnvelope } from '../src/index.js'

const context = { tenantId: 't', environmentId: 'e', botId: 'b', providerId: 'p', connectionId: 'c' }
const env = (id: string) => createEnvelope({ eventId: id, eventType: 'test.event', occurredAt: 1, context, payload: { id } })

let dir: string
let file: string
const open: Array<{ close(): Promise<void> }> = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botwa-events-corrupt-')); file = join(dir, 'events.json') })
afterEach(async () => {
  while (open.length) await open.pop()!.close()
  rmSync(dir, { recursive: true, force: true })
})

async function logWith(edit: (lines: string[]) => string): Promise<string> {
  const a = await SharedFileEventJournal.open(file, { appendLog: true })
  for (const id of ['e1', 'e2', 'e3']) await a.append(env(id))
  await a.close()
  const text = edit(readFileSync(`${file}.log`, 'utf8').split('\n'))
  writeFileSync(`${file}.log`, text)
  return text
}

describe('SharedFileEventJournal append log corruption', () => {
  it('refuses to open with a corrupt line in the middle, leaving the log untouched', async () => {
    const text = await logWith((lines) => [lines[0], '{"s":2,"e":{garbage', lines[2], ''].join('\n'))
    await expect(SharedFileEventJournal.open(file, { appendLog: true })).rejects.toMatchObject({ code: 'APPEND_LOG_CORRUPT', message: expect.stringMatching(/line 2/) })
    expect(readFileSync(`${file}.log`, 'utf8')).toBe(text)
  })

  it('still cuts a torn last line', async () => {
    await logWith((lines) => [lines[0], lines[1], '{"s":3,"e":{gar'].join('\n'))
    const b = await SharedFileEventJournal.open(file, { appendLog: true })
    open.push(b)
    expect((await b.list()).map((r) => r.envelope.eventId).sort()).toEqual(['e1', 'e2'])
  })
})

describe('event journal fsync', () => {
  it('fsync: true writes snapshots that reopen (file and shared journals)', async () => {
    const a = await FileEventJournal.open(file, { fsync: true })
    await a.append(env('e1'))
    await a.close()
    const b = await SharedFileEventJournal.open(file, { fsync: true })
    open.push(b)
    expect((await b.get('e1'))?.state).toBe('pending')
    await b.append(env('e2'))
    expect((await b.list()).length).toBe(2)
  })

  it('rejects a non-boolean fsync', async () => {
    await expect(FileEventJournal.open(file, { fsync: 1 as never })).rejects.toThrow(/fsync/)
    await expect(SharedFileEventJournal.open(file, { fsync: 'yes' as never })).rejects.toThrow(/fsync/)
  })
})
