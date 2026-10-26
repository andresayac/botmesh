/**
 * Durable scheduler: a slot that falls due while the previous occurrence still runs (a slow
 * handler, or a run that started late after a fail-over) is not silently dropped under the
 * 'catch-up' and 'run-once' policies: it is claimed next and goes through the policy like
 * any slot (run normally within the grace period, else as missed). 'skip' keeps going on
 * with the first slot after the run ended, as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScheduledRun } from '../src/core/types.js'
import { MemoryScheduleStore } from '../src/scheduler/ScheduleStore.js'
import { Scheduler } from '../src/scheduler/Scheduler.js'

const T0 = new Date(2026, 0, 5, 8, 0, 0, 0).getTime()
const SEC = 1000
const MIN = 60 * SEC

afterEach(() => { vi.useRealTimers() })

async function slowFirstRun(policy: 'skip' | 'run-once' | 'catch-up') {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  const store = new MemoryScheduleStore()
  const s = new Scheduler({ store })
  const runs: ScheduledRun[] = []
  s.every('1m', { id: 'job', missed: policy }, async (run) => {
    runs.push(run)
    // The first occurrence takes 2m30s: the slots at 2m and 3m fall due while it runs.
    if (runs.length === 1) await new Promise((r) => setTimeout(r, 2 * MIN + 30 * SEC))
  })
  await s.start()
  await vi.advanceTimersByTimeAsync(5 * MIN + 10 * SEC)
  s.stop()
  return runs.map((r) => [(r.scheduledAt.getTime() - T0) / MIN, r.missed] as const)
}

describe('durable scheduler: slots that fall due while an occurrence runs', () => {
  it("'catch-up' runs them after it, flagged missed", async () => {
    expect(await slowFirstRun('catch-up')).toEqual([[1, false], [2, true], [3, true], [4, false], [5, false]])
  })

  it("'run-once' runs one of them, flagged missed", async () => {
    expect(await slowFirstRun('run-once')).toEqual([[1, false], [2, true], [4, false], [5, false]])
  })

  it("'skip' goes on with the first slot after the run (unchanged)", async () => {
    expect(await slowFirstRun('skip')).toEqual([[1, false], [4, false], [5, false]])
  })
})
