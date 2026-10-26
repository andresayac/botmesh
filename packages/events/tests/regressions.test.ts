import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createEnvelope, EventWorker, FileEventJournal, MemoryEventJournal } from '../src/index.js'

const context = { tenantId: 't', environmentId: 'prod', botId: 'b', providerId: 'p', connectionId: 'c', chatId: 'chat' }

describe('FileEventJournal write failures', () => {
  it('keeps persisting after one failed write (the write queue is not poisoned)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'botwa-events-'))
    try {
      const blocker = join(dir, 'sub')
      const path = join(blocker, 'journal.json')
      const journal = await FileEventJournal.open(path)
      // A file where the parent directory should be: the first write fails.
      await writeFile(blocker, 'not a directory')
      await expect(journal.append(createEnvelope({ eventType: 'a', context, payload: 1 }))).rejects.toThrow()

      await rm(blocker)
      await expect(journal.append(createEnvelope({ eventType: 'b', context, payload: 2 }))).resolves.toBe(true)
      const saved = JSON.parse(await readFile(path, 'utf8')) as { records: unknown[] }
      expect(saved.records).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('EventWorker.on unsubscribe', () => {
  it('a stale unsubscribe does not remove a handler registered later for the same type', async () => {
    const journal = new MemoryEventJournal()
    const worker = new EventWorker(journal)
    const off = worker.on('x', () => {})
    off()
    const seen: unknown[] = []
    worker.on('x', (e) => { seen.push(e.payload) })
    off() // stale: must be a no-op
    await journal.append(createEnvelope({ eventType: 'x', context, payload: 42 }))
    expect(await worker.runBatch()).toEqual({ processed: 1, failed: 0, stale: 0 })
    expect(seen).toEqual([42])
  })
})

describe('dead letters reached by maxAttempts', () => {
  it('record completedAt, so purge({ includeDead }) can remove them (no unbounded DLQ growth)', async () => {
    const journal = new MemoryEventJournal()
    let now = 1_000
    const worker = new EventWorker(journal, { maxAttempts: 1, clock: () => now })
    worker.on('boom', () => { throw new Error('nope') })
    await journal.append(createEnvelope({ eventId: 'e1', eventType: 'boom', occurredAt: now, context, payload: 1 }))
    expect(await worker.runBatch()).toEqual({ processed: 0, failed: 1, stale: 0 })

    const dead = await journal.get('e1')
    expect(dead).toMatchObject({ state: 'dead', completedAt: 1_000, lastError: 'nope' })
    now = 5_000
    expect(await journal.purge({ doneBefore: 2_000, includeDead: true })).toBe(1)
    expect(await journal.get('e1')).toBeUndefined()
  })

  it('a replayed dead letter forgets its completedAt', async () => {
    const journal = new MemoryEventJournal()
    await journal.append(createEnvelope({ eventId: 'e1', eventType: 'x', occurredAt: 1, context, payload: 1 }))
    const [r] = await journal.claim(1, { now: 1 })
    await journal.fail('e1', new Error('x'), { now: 2, fencingToken: r!.fencingToken, maxAttempts: 1 })
    await journal.replay('e1', 3)
    expect((await journal.get('e1'))?.completedAt).toBeUndefined()
  })
})
