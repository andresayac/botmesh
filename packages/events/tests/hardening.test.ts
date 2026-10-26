/** Release-readiness hardening: bad input never poisons a journal, and user mistakes fail early with a clear message. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEnvelope, EventWorker, FileEventJournal, MemoryEventJournal, SharedFileEventJournal } from '../src/index.js'

const context = { tenantId: 't', environmentId: 'e', botId: 'b', providerId: 'p', connectionId: 'c' }
const env = (id: string, payload: unknown = { id }) => createEnvelope({ eventId: id, eventType: 'test.event', occurredAt: 1, context, payload })

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botwa-events-')); file = join(dir, 'events.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('non-JSON payloads', () => {
  it('FileEventJournal rejects a BigInt or circular payload without poisoning later writes', async () => {
    const j = await FileEventJournal.open(file)
    await expect(j.append(env('big', { n: 1n }))).rejects.toThrow(/JSON/)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(j.append(env('circ', circular))).rejects.toThrow(/JSON/)
    expect(await j.get('big')).toBeUndefined()
    expect(await j.get('circ')).toBeUndefined()
    await expect(j.append(env('ok'))).resolves.toBe(true)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { records: Array<{ envelope: { eventId: string } }> }
    expect(saved.records.map((r) => r.envelope.eventId)).toEqual(['ok'])
    await j.close()
  })

  it('FileEventJournal keeps in memory exactly what it wrote (a Date reads back as its JSON string)', async () => {
    const j = await FileEventJournal.open(file)
    await j.append(env('d', { at: new Date(0) }))
    expect((await j.get('d'))?.envelope.payload).toEqual({ at: '1970-01-01T00:00:00.000Z' })
    await j.close()
  })

  it('SharedFileEventJournal names the problem', async () => {
    const j = await SharedFileEventJournal.open(file)
    await expect(j.append(env('big', 1n))).rejects.toThrow(/JSON/)
    await expect(j.append(env('ok'))).resolves.toBe(true)
    await j.close()
  })

  it('MemoryEventJournal stores a copy: mutating the envelope after append changes nothing', async () => {
    const m = new MemoryEventJournal()
    const e = env('a', { v: 1 })
    await m.append(e)
    ;(e.payload as { v: number }).v = 2
    e.eventType = 'changed'
    expect((await m.get('a'))?.envelope).toMatchObject({ eventType: 'test.event', payload: { v: 1 } })
  })
})

describe('numeric options are validated', () => {
  it('EventWorker rejects invalid maxAttempts, retryDelayMs, leaseMs and clock', () => {
    const m = new MemoryEventJournal()
    expect(() => new EventWorker(m, { maxAttempts: 0 })).toThrow(/maxAttempts/)
    expect(() => new EventWorker(m, { maxAttempts: 1.5 })).toThrow(/maxAttempts/)
    expect(() => new EventWorker(m, { retryDelayMs: Number.NaN })).toThrow(/retryDelayMs/)
    expect(() => new EventWorker(m, { retryDelayMs: -1 })).toThrow(/retryDelayMs/)
    expect(() => new EventWorker(m, { leaseMs: 0 })).toThrow(/leaseMs/)
    expect(() => new EventWorker(m, { leaseMs: Number.POSITIVE_INFINITY })).toThrow(/leaseMs/)
    expect(() => new EventWorker(m, { clock: 5 as never })).toThrow(/clock/)
    expect(() => new EventWorker(m, { maxAttempts: 1, retryDelayMs: 0, leaseMs: 1 })).not.toThrow()
  })

  it('journals reject a lease or retry time that would strand a record forever', async () => {
    const m = new MemoryEventJournal()
    await m.append(env('a'))
    await expect(m.claim(1, { leaseMs: Number.NaN })).rejects.toThrow(/leaseMs/)
    await expect(m.claim(1, { leaseMs: -5 })).rejects.toThrow(/leaseMs/)
    await expect(m.claim(1, { now: Number.NaN })).rejects.toThrow(/now/)
    const [claimed] = await m.claim(1)
    await expect(m.fail('a', 'x', { fencingToken: claimed!.fencingToken, retryDelayMs: Number.NaN })).rejects.toThrow(/retryDelayMs/)
    await expect(m.fail('a', 'x', { fencingToken: claimed!.fencingToken, retryAt: Number.NaN })).rejects.toThrow(/retryAt/)
    await expect(m.fail('a', 'x', { fencingToken: claimed!.fencingToken, maxAttempts: 0 })).rejects.toThrow(/maxAttempts/)
    // Still processing under the same claim: nothing was changed by the rejected calls.
    expect((await m.get('a'))?.state).toBe('processing')
    await expect(m.claimOne('a', { now: 1, leaseMs: Number.NaN, owner: 'o' })).rejects.toThrow(/leaseMs/)
    await expect(m.list({ limit: -1 })).rejects.toThrow(/limit/)
  })
})

describe('createEnvelope input errors', () => {
  it('explains a missing eventType or context', () => {
    expect(() => createEnvelope({ context, payload: 1 } as never)).toThrow(/eventType/)
    expect(() => createEnvelope({ eventType: 'x', payload: 1 } as never)).toThrow(/context/)
    expect(() => createEnvelope({ eventType: 'x', context: { botId: 'b' }, payload: 1 } as never)).toThrow(/context\.tenantId/)
  })
})

describe('corrupt snapshot errors', () => {
  it('name the file and the problem', async () => {
    writeFileSync(file, '{not json')
    await expect(FileEventJournal.open(file)).rejects.toThrow(/invalid event journal snapshot.*events\.json/)
    writeFileSync(file, JSON.stringify({ version: 1, records: [{ foo: 1 }] }))
    await expect(FileEventJournal.open(file)).rejects.toThrow(/invalid event journal snapshot.*events\.json.*record 0/)
    await expect(SharedFileEventJournal.open(file)).rejects.toThrow(/invalid event journal snapshot.*record 0/)
  })
})

describe('closed FileEventJournal', () => {
  it('a write after close() changes nothing in memory either', async () => {
    const j = await FileEventJournal.open(file)
    await j.append(env('a'))
    await j.close()
    await expect(j.append(env('late'))).rejects.toThrow(/closed/)
    expect(await j.get('late')).toBeUndefined()
    await expect(j.claim(1)).rejects.toThrow(/closed/)
    expect((await j.get('a'))?.state).toBe('pending')
  })
})
