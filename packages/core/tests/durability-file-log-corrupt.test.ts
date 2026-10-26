/**
 * A corrupt line in the MIDDLE of `<file>.log` is not a torn tail: replaying past it would
 * silently drop every later entry, so `FileDurability.open()` refuses with a clear error
 * (file, line, byte offset) and leaves the log untouched. Snapshots can be fsynced
 * (`fsync: true`) before they replace the previous one.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileDurability } from '../src/index.js'

const append = (j: FileDurability, id: string) =>
  j.inbox.append({ id, partitionKey: 'p', kind: 'message', payload: { id }, receivedAt: 1 }, 1)

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botwa-dur-log-corrupt-')); file = join(dir, 'journal.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** A journal whose snapshot predates the log (a crash before compaction), log as given. */
async function leftoverLog(edit: (lines: string[]) => string): Promise<string> {
  const a = await FileDurability.open(file, { appendLog: true })
  for (const id of ['e1', 'e2', 'e3']) await append(a, id)
  const log = readFileSync(`${file}.log`, 'utf8')
  await a.close()
  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  writeFileSync(file, JSON.stringify({ ...snapshot, logSeq: 0, entries: [] }))
  const text = edit(log.split('\n'))
  writeFileSync(`${file}.log`, text)
  return text
}

describe('append log corruption', () => {
  it('refuses to open when a line in the middle is corrupt, and leaves the log as it was', async () => {
    const text = await leftoverLog((lines) => [lines[0], '{"s":2,"e":{garbage', lines[2], ''].join('\n'))
    const error = await FileDurability.open(file, { appendLog: true }).then(() => undefined, (e: unknown) => e as Error & { code?: string })
    expect(error).toBeInstanceOf(Error)
    expect(error?.code).toBe('APPEND_LOG_CORRUPT')
    expect(error?.message).toMatch(/journal\.json\.log/)
    expect(error?.message).toMatch(/line 2/)
    expect(error?.message).toMatch(/later entries/)
    expect(readFileSync(`${file}.log`, 'utf8')).toBe(text)
    // The lock was released: once the log is repaired, the journal opens.
    writeFileSync(`${file}.log`, text.split('\n').filter((l) => !l.includes('garbage')).join('\n'))
    const b = await FileDurability.open(file, { appendLog: true })
    await b.close()
  })

  it('a well-formed line with the wrong shape in the middle is corruption too', async () => {
    await leftoverLog((lines) => [lines[0], '{"x":1}', lines[2], ''].join('\n'))
    await expect(FileDurability.open(file, { appendLog: true })).rejects.toMatchObject({ code: 'APPEND_LOG_CORRUPT' })
  })

  it('a corrupt LAST line is still a torn tail: cut, the rest replayed', async () => {
    await leftoverLog((lines) => [lines[0], lines[1], '{"s":3,"e":{garb'].join('\n'))
    const b = await FileDurability.open(file, { appendLog: true })
    expect(await b.inbox.get('e1')).toMatchObject({ state: 'pending' })
    expect(await b.inbox.get('e2')).toMatchObject({ state: 'pending' })
    await b.close()
  })

  it('a garbled last line followed only by blank space is a torn tail', async () => {
    await leftoverLog((lines) => [lines[0], '{"s":2,"e":{garb', '', ''].join('\n'))
    const b = await FileDurability.open(file, { appendLog: true })
    expect(await b.inbox.get('e1')).toMatchObject({ state: 'pending' })
    await b.close()
  })
})

describe('snapshot fsync', () => {
  it('fsync: true writes and reopens the journal (whole-snapshot and append-log modes)', async () => {
    const a = await FileDurability.open(file, { fsync: true })
    await append(a, 'e1')
    await a.close()
    const b = await FileDurability.open(file, { fsync: true, appendLog: { compactEvery: 1 } })
    await append(b, 'e2')
    await b.close()
    const c = await FileDurability.open(file)
    expect(await c.inbox.get('e1')).toMatchObject({ state: 'pending' })
    expect(await c.inbox.get('e2')).toMatchObject({ state: 'pending' })
    await c.close()
  })

  it('rejects a non-boolean fsync', async () => {
    await expect(FileDurability.open(file, { fsync: 'yes' as never })).rejects.toThrow(/fsync/)
  })
})
