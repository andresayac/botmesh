/**
 * AppendLog.replay (the `<file>.log` reader of the append-only journals) reads a log in
 * linear time — it used to re-measure the whole prefix for every line, so a long log
 * (a high `compactEvery`, or the shared events journal, which replays on every operation)
 * took seconds to minutes — and keeps exact byte offsets with multi-byte text, so a torn
 * tail is cut on the right byte.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppendLog } from '../src/durability/fileLog.js'

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botwa-log-replay-')); file = join(dir, 'journal.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const line = (s: number, text: string) => `${JSON.stringify({ s, e: { text } })}\n`

describe('AppendLog.replay', () => {
  it('reads a long log in linear time', async () => {
    let log = ''
    for (let s = 1; s <= 40_000; s++) log += line(s, 'x'.repeat(80))
    writeFileSync(`${file}.log`, log)
    const started = performance.now()
    const replay = await AppendLog.replay(file, 0)
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(replay.entries).toHaveLength(40_000)
    expect(replay.bytes).toBe(statSync(`${file}.log`).size)
  })

  it('counts bytes exactly with multi-byte text and cuts a torn tail on the right byte', async () => {
    const complete = line(1, 'ñandú 🦜 ✓') + line(2, '日本語テキスト') + line(3, 'emoji 👩‍👩‍👧‍👦')
    writeFileSync(`${file}.log`, `${complete}{"s":4,"e":{"text":"🦜 torn`)
    const replay = await AppendLog.replay<{ text: string }>(file, 1)
    expect(replay.torn).toBe(true)
    expect(replay.entries.map((e) => e.s)).toEqual([2, 3])
    expect(replay.lastSeq).toBe(3)
    expect(replay.bytes).toBe(Buffer.byteLength(complete, 'utf8'))
    expect(readFileSync(`${file}.log`, 'utf8')).toBe(complete)
  })
})
