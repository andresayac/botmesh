/**
 * `durability.inbox.leaseMs` / `outbox.leaseMs` too short for the heartbeat to renew (0, a
 * few ms) used to be clamped silently: every record then looked abandoned at once, the
 * sweeper re-claimed it while the handler ran and a message that was handled fine ended
 * dead-lettered. They are rejected when the bot is built instead.
 */
import { describe, expect, it } from 'vitest'
import { Bot, MemoryDurability } from '../src/index.js'
import { MockProvider } from '../src/testing/index.js'
import { ConfigValidationError } from '../src/utils/validateConfig.js'

const make = (durability: ConstructorParameters<typeof Bot>[0]['durability']) =>
  new Bot({ provider: new MockProvider(), durability })

describe('durability lease durations', () => {
  it.each([0, 1, 19, '10ms'])('rejects inbox.leaseMs %s', (leaseMs) => {
    expect(() => make({ journal: new MemoryDurability(), inbox: { leaseMs } })).toThrow(ConfigValidationError)
    expect(() => make({ journal: new MemoryDurability(), inbox: { leaseMs } })).toThrow(/durability\.inbox\.leaseMs.*20 ms/)
  })

  it.each([0, 5])('rejects outbox.leaseMs %s', (leaseMs) => {
    expect(() => make({ journal: new MemoryDurability(), outbox: { leaseMs } })).toThrow(/durability\.outbox\.leaseMs.*20 ms/)
  })

  it.each([20, 40, '1s'])('accepts %s', (leaseMs) => {
    expect(() => make({ journal: new MemoryDurability(), inbox: { leaseMs }, outbox: { leaseMs } })).not.toThrow()
  })
})
