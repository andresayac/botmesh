/** Seeded fuzzing of the on-disk formats: a damaged snapshot or append log either opens and works, or is refused with a clear error. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEnvelope, EventWorker, FileEventJournal, SharedFileEventJournal } from '../src/index.js'

const context = { tenantId: 't', environmentId: 'e', botId: 'b', providerId: 'p', connectionId: 'c' }

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const JUNK = ['null', '"x"', '-1', '1e309', '{}', '[]', 'true', '"🙂"', '{"__proto__":{"polluted":1}}']

/** Replace one JSON value somewhere in `text` (between punctuation) with junk, or flip a byte. */
function mutate(text: string, rand: () => number): string {
  const r = rand()
  const at = Math.floor(rand() * text.length)
  if (r < 0.3) return text.slice(0, at) + text.slice(at + 1 + Math.floor(rand() * 4))
  if (r < 0.5) return text.slice(0, at) + String.fromCharCode(32 + Math.floor(rand() * 95)) + text.slice(at + 1)
  // Swap a value after a ':' with junk.
  const colon = text.indexOf(':', at)
  if (colon < 0) return text.slice(0, at)
  let end = colon + 1
  let depth = 0
  for (; end < text.length; end++) {
    const ch = text[end]
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') { if (depth === 0) break; depth-- }
    else if (ch === ',' && depth === 0) break
  }
  return text.slice(0, colon + 1) + JUNK[Math.floor(rand() * JUNK.length)] + text.slice(end)
}

let dir: string
let base: string
let baseLog: string
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'botwa-events-fuzz-'))
  const seed = join(dir, 'seed.json')
  const j = await SharedFileEventJournal.open(seed, { appendLog: { compactEvery: 1000 } })
  for (let i = 0; i < 4; i++) await j.append(createEnvelope({ eventId: `e${i}`, eventType: 'x', occurredAt: 1, context, payload: { i, s: 'ñ🙂' } }))
  const [c] = await j.claim(1, { now: 2 })
  await j.fail(c!.envelope.eventId, new Error('x'), { now: 2, fencingToken: c!.fencingToken })
  await j.updateSidecar('side', () => ({ data: { n: 1 }, result: undefined }))
  await j.close()
  baseLog = readFileSync(`${seed}.log`, 'utf8')
  const f = await FileEventJournal.open(join(dir, 'snap.json'))
  for (let i = 0; i < 4; i++) await f.append(createEnvelope({ eventId: `e${i}`, eventType: 'x', occurredAt: 1, context, payload: { i } }))
  await f.claim(1, { now: 2 })
  await f.close()
  base = readFileSync(join(dir, 'snap.json'), 'utf8')
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

const FAR = 1e15

/**
 * Open, then prove every live record is still usable: each pending, failed or processing record
 * can be claimed (once its lease or retry time has passed) and completed under the fencing token
 * of that claim; then run a worker batch, a list and an append. The journal either refuses to
 * open with a clear Error, or works. `laterDamage`: the shared journal replays its append log on
 * every call, so a damaged log entry may only be found then (and must be named).
 */
async function exercise(open: () => Promise<FileEventJournal | SharedFileEventJournal>, laterDamage = false): Promise<'ok' | 'refused'> {
  let j: FileEventJournal | SharedFileEventJournal
  try {
    j = await open()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/invalid event journal|append log/)
    return 'refused'
  }
  try {
    const live = (await j.list({ limit: Number.POSITIVE_INFINITY })).filter((r) => r.state === 'pending' || r.state === 'failed' || r.state === 'processing')
    for (const record of live) {
      const claimed = await j.claimOne(record.envelope.eventId, { now: FAR, leaseMs: 1_000, owner: 'fuzz' })
      // A record that opens is never stranded: due or expired, it can be claimed and completed.
      expect(claimed, `record ${record.envelope.eventId} (${JSON.stringify(record)}) is stranded`).not.toBeNull()
      await j.ack(record.envelope.eventId, { now: FAR, fencingToken: claimed!.fencingToken })
      expect((await j.get(record.envelope.eventId))?.state).toBe('done')
    }
    const w = new EventWorker(j, { retryDelayMs: 0 })
    w.on('x', () => {})
    await w.runBatch(10)
    await j.list({ limit: Number.POSITIVE_INFINITY })
    expect(await j.append(createEnvelope({ eventType: 'x', context, payload: 1 }))).toBe(true)
  } catch (error) {
    if (!laterDamage) throw error
    expect((error as Error).message).toMatch(/invalid event journal append log/)
  } finally {
    await j.close()
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  return 'ok'
}

describe('fuzzed snapshot', () => {
  it('300 mutated FileEventJournal snapshots open cleanly or are refused clearly', async () => {
    const rand = prng(0xC0FFEE)
    const tally = { ok: 0, refused: 0 }
    for (let i = 0; i < 300; i++) {
      const file = join(dir, `f${i}.json`)
      writeFileSync(file, mutate(base, rand))
      tally[await exercise(() => FileEventJournal.open(file))]++
    }
    // Both paths are exercised: some damage is harmless, some is refused.
    expect(tally.ok).toBeGreaterThan(0)
    expect(tally.refused).toBeGreaterThan(0)
  }, 60_000)

  it('150 mutated append logs open cleanly or are refused clearly', async () => {
    const rand = prng(0xBADF00D)
    const tally = { ok: 0, refused: 0 }
    for (let i = 0; i < 150; i++) {
      const file = join(dir, `l${i}.json`)
      writeFileSync(`${file}.log`, mutate(baseLog, rand))
      tally[await exercise(() => SharedFileEventJournal.open(file, { appendLog: true }), true)]++
    }
    expect(tally.ok).toBeGreaterThan(0)
    expect(tally.refused).toBeGreaterThan(0)
  }, 120_000)
})
