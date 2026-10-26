/**
 * A damaged `FileDurability` journal (a truncated or hand-edited snapshot, a log entry that
 * is not a journal mutation) is refused on open with an error that names the file and says
 * what to do, never a bare `SyntaxError`/`TypeError` from deep inside, and never applied
 * half-way. The lock is released, so the next open (after a fix) works.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileDurability } from '../src/index.js'
import { MemoryKv } from '../src/spi.js'

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botwa-dur-corrupt-')); file = join(dir, 'journal.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

async function expectRefused(pattern: RegExp): Promise<void> {
  const error = await FileDurability.open(file).then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toMatch(pattern)
  expect((error as Error).message).toContain('journal.json')
  expect(existsSync(`${file}.lock`)).toBe(false)
}

describe('FileDurability refuses a damaged journal with an actionable error', () => {
  it.each([
    ['an empty snapshot (a crash or power loss mid-write)', ''],
    ['a truncated snapshot', '{"version":1,"tables":{"inbox":[["a","{'],
    ['a snapshot that is not an object', 'null'],
    ['an unknown snapshot version', '{"version":2,"tables":{}}'],
    ['a row that is not [id, value, version, due, done]', '{"version":1,"tables":{"inbox":[[1,2]]}}'],
    ['a row with a non-numeric version', '{"version":1,"tables":{"inbox":[["a","{}","x",null,null]]}}'],
  ])('%s', async (_label, content) => {
    writeFileSync(file, content)
    await expectRefused(/not a valid durability journal/)
    rmSync(file)
    const journal = await FileDurability.open(file)
    await journal.close()
  })

  it.each([
    ['a null entry', '{"s":1,"e":null}\n'],
    ['an insert without an id', '{"s":1,"e":{"op":"insert","table":"inbox","value":"{}","version":"1","index":{"due":null,"done":null}}}\n'],
    ['an unknown op', '{"s":1,"e":{"op":"drop","table":"inbox","id":"a"}}\n'],
  ])('a log with %s', async (_label, content) => {
    writeFileSync(`${file}.log`, content)
    await expectRefused(/journal\.json\.log.*not a valid durability journal/)
  })

  it('MemoryKv.restore rejects malformed rows', () => {
    const kv = new MemoryKv()
    expect(() => kv.restore({ version: 1, tables: { inbox: [[1, 2]] } } as never)).toThrow(/invalid durability snapshot/)
  })
})
