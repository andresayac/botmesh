/** Records are validated before they are stored, with the same rules the snapshot reader applies: nothing a journal accepts can make it refuse to reopen. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEnvelope, FileEventJournal, MemoryEventJournal, SharedFileEventJournal, type EventEnvelope, type LeasedEventJournal } from '../src/index.js'

const context = { tenantId: 't', environmentId: 'e', botId: 'b', providerId: 'p', connectionId: 'c' }
const env = (id: string) => createEnvelope({ eventId: id, eventType: 'test.event', occurredAt: 1, context, payload: { id } })

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botwa-events-rv-')); file = join(dir, 'events.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('createEnvelope occurredAt', () => {
  it('rejects a non-finite or non-number occurredAt', () => {
    for (const occurredAt of [Number.NaN, Number.POSITIVE_INFINITY, new Date() as unknown as number, '1' as unknown as number]) {
      expect(() => createEnvelope({ eventType: 'x', occurredAt, context, payload: 1 })).toThrow(/occurredAt/)
    }
    expect(createEnvelope({ eventType: 'x', occurredAt: 0, context, payload: 1 }).occurredAt).toBe(0)
  })
})

type Kind = 'memory' | 'file' | 'shared'
const openers: Record<Kind, () => Promise<LeasedEventJournal & { close?(): Promise<void> }>> = {
  memory: async () => new MemoryEventJournal(),
  file: () => FileEventJournal.open(file),
  shared: () => SharedFileEventJournal.open(file),
}

/** Hand-built envelopes (the type is public) that are not valid records. */
const bad: Array<[string, () => EventEnvelope, RegExp]> = [
  ['occurredAt NaN', () => ({ ...env('bad'), occurredAt: Number.NaN }), /occurredAt/],
  ['occurredAt Infinity', () => ({ ...env('bad'), occurredAt: Number.POSITIVE_INFINITY }), /occurredAt/],
  ['occurredAt a Date', () => ({ ...env('bad'), occurredAt: new Date() as unknown as number }), /occurredAt/],
  ['no partitionKey', () => { const e = env('bad') as Partial<EventEnvelope>; delete e.partitionKey; return e as EventEnvelope }, /partitionKey/],
  ['no idempotencyKey', () => { const e = env('bad') as Partial<EventEnvelope>; delete e.idempotencyKey; return e as EventEnvelope }, /idempotencyKey/],
  ['no eventType', () => { const e = env('bad') as Partial<EventEnvelope>; delete e.eventType; return e as EventEnvelope }, /eventType/],
  ['no context', () => { const e = env('bad') as Partial<EventEnvelope>; delete e.context; return e as EventEnvelope }, /context/],
]

describe.each(['memory', 'file', 'shared'] as Kind[])('%s journal rejects an invalid record before storing it', (kind) => {
  it.each(bad)('%s', async (_name, make, why) => {
    const j = await openers[kind]()
    await expect(j.append(make())).rejects.toThrow(why)
    expect(await j.get('bad')).toBeUndefined()
    await expect(j.append(env('ok'))).resolves.toBe(true)
    await j.close?.()
    if (kind !== 'memory') {
      const again = await openers[kind]()
      expect((await again.list({ limit: Number.POSITIVE_INFINITY })).map((r) => r.envelope.eventId)).toEqual(['ok'])
      await again.close?.()
    }
  })

  it('rejects a non-finite `now` fallback for nextAttemptAt (no NaN record that is never claimable)', async () => {
    const j = await openers[kind]()
    await expect(j.appendRecord({ ...env('n'), occurredAt: Number.NaN })).rejects.toThrow(/occurredAt/)
    await j.append(env('ok'))
    expect((await j.claim(5, { now: 10 })).map((r) => r.envelope.eventId)).toEqual(['ok'])
    await j.close?.()
  })
})

describe('file journals store what the envelope serializes to', () => {
  it.each(['file', 'shared'] as const)('%s: an envelope whose toJSON rewrites its identity is refused', async (kind) => {
    const j = await openers[kind]()
    const e = Object.assign(env('w'), { toJSON() { return { ...env('swapped') } } })
    await expect(j.append(e)).rejects.toThrow(/toJSON|serializ/)
    expect(await j.get('w')).toBeUndefined()
    expect(await j.get('swapped')).toBeUndefined()
    await j.close?.()
  })
})

describe('snapshot records with damaged lease fields are refused, not stranded', () => {
  const record = (extra: Record<string, unknown>) => ({ envelope: env('r'), state: 'processing', attempts: 1, nextAttemptAt: 1, leaseUntil: 5, fencingToken: 1, ...extra })
  it.each([
    ['leaseUntil', { leaseUntil: 'x' }],
    ['fencingToken', { fencingToken: 'x' }],
    ['fencingToken', { fencingToken: -1 }],
    ['owner', { owner: 5 }],
    ['channel', { channel: 5 }],
    ['completedAt', { completedAt: 'x' }],
    ['lastError', { lastError: 5 }],
    ['attempts', { attempts: -1 }],
    ['nextAttemptAt', { nextAttemptAt: null }],
    ['occurredAt', { envelope: { ...env('r'), occurredAt: null } }],
    ['context', { envelope: { ...env('r'), context: null } }],
  ])('%s %j', async (field, extra) => {
    writeFileSync(file, JSON.stringify({ version: 1, records: [record(extra)] }))
    await expect(FileEventJournal.open(file)).rejects.toThrow(new RegExp(`record 0: .*${field}`))
    await expect(SharedFileEventJournal.open(file)).rejects.toThrow(new RegExp(`record 0: .*${field}`))
  })

  it('a valid processing record still opens and is reclaimed after its lease', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, records: [record({ owner: 'a', channel: 'ch' })] }))
    const j = await FileEventJournal.open(file)
    const [claimed] = await j.claim(1, { now: 10, channel: 'ch' })
    expect(claimed?.fencingToken).toBe(2)
    await j.ack('r', { fencingToken: 2 })
    await j.close()
  })
})

describe('lease owners are validated before they are stored', () => {
  it.each(['memory', 'file'] as const)('%s: a non-string owner is rejected and changes nothing', async (kind) => {
    const j = await openers[kind]()
    await j.append(env('a'))
    await expect(j.claim(1, { now: 10, owner: 5 as never })).rejects.toThrow(/owner/)
    await expect(j.claimOne('a', { now: 10, leaseMs: 100, owner: 5 as never })).rejects.toThrow(/owner/)
    await expect(j.appendRecord(env('b'), { lease: { now: 10, leaseMs: 100, owner: 5 as never } })).rejects.toThrow(/owner/)
    await expect(j.appendRecord(env('c'), { channel: 5 as never })).rejects.toThrow(/channel/)
    expect((await j.get('a'))?.state).toBe('pending')
    expect(await j.get('b')).toBeUndefined()
    await j.close?.()
    if (kind === 'file') {
      const again = await openers[kind]()
      expect((await again.list()).map((r) => r.envelope.eventId)).toEqual(['a'])
      await again.close?.()
    }
  })
})
