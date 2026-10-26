/**
 * Duration options: every `*Ms` option (and every other duration option) of `BotConfig` takes a
 * duration string (`'30s'`, `'2m'`) or milliseconds, and an invalid value is rejected at
 * construction with a `ConfigValidationError` that names the option.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Bot, ConfigValidationError, MemoryCoordinator, MemoryLeaseProvider, type BotConfig } from '../src/index.js'
import { MockProvider } from '../src/testing/index.js'
import { normalizeTypingConfig } from '../src/internal.js'
import { computeBackoff } from '../src/durability/backoff.js'

const bots: Bot[] = []
afterEach(async () => {
  for (const b of bots.splice(0)) await b.stop().catch(() => {})
})

function silent(): BotConfig['logger'] {
  const noop = () => {}
  const l = { debug: noop, info: noop, warn: noop, error: noop, child: () => l }
  return l
}

/** Builds a config with `value` at the dotted `path`. */
function withOption(path: string, value: unknown): Partial<BotConfig> {
  const root: Record<string, unknown> = {}
  const parts = path.split('.')
  let node = root
  for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>
  node[parts[parts.length - 1]!] = value
  // Options that need a sibling to be accepted at all.
  if (path.startsWith('coordination.')) (root.coordination as Record<string, unknown>).coordinator = new MemoryCoordinator()
  if (path.startsWith('scheduler.') && path !== 'scheduler.tickMs') {
    (root.scheduler as Record<string, unknown>).lease = new MemoryLeaseProvider()
  }
  return root as Partial<BotConfig>
}

const DURATION_OPTIONS = [
  'conversation.timeout',
  'dedupe.ttl',
  'echoFilter.ttl',
  'typing.minMs',
  'typing.maxMs',
  'durability.pollMs',
  'durability.retention',
  'durability.inbox.leaseMs',
  'durability.inbox.backoff.baseMs',
  'durability.inbox.backoff.capMs',
  'durability.outbox.leaseMs',
  'durability.outbox.inlineMaxMs',
  'durability.outbox.backoff.baseMs',
  'durability.outbox.backoff.capMs',
  'coordination.turnWaitMs',
  'coordination.settleMs',
  'coordination.providerDownMs',
  'coordination.handover.ttl',
  'scheduler.tickMs',
  'scheduler.leaderTtlMs',
  'storeConfig.autoSaveInterval',
] as const

describe('duration options', () => {
  it.each(DURATION_OPTIONS)('%s: an invalid duration throws a ConfigValidationError naming the option', (path) => {
    let error: unknown
    try {
      bots.push(new Bot({ provider: new MockProvider(), logger: silent(), ...withOption(path, 'soon') }))
    } catch (e) {
      error = e
    }
    expect(error, path).toBeInstanceOf(ConfigValidationError)
    expect((error as ConfigValidationError).field).toBe(path)
    expect((error as Error).message).toContain(`config.${path}`)
    expect((error as Error).message).toMatch(/duration/)
  })

  it.each(DURATION_OPTIONS)('%s: accepts a duration string', (path) => {
    const value = path === 'typing.minMs' ? '100ms' : path === 'durability.inbox.leaseMs' || path === 'durability.outbox.leaseMs' ? '30s' : '2s'
    expect(() => bots.push(new Bot({ provider: new MockProvider(), logger: silent(), ...withOption(path, value) }))).not.toThrow()
  })

  it('typing.minMs / maxMs take duration strings', () => {
    expect(normalizeTypingConfig({ minMs: '1s', maxMs: '2.5s' })).toMatchObject({ minMs: 1000, maxMs: 2500 })
  })

  it('backoff.baseMs / capMs take duration strings', () => {
    const delay = computeBackoff({ baseMs: '1s', capMs: '1m', jitter: 0 }, 3)
    expect(delay).toBe(4000)
    expect(computeBackoff({ baseMs: '1s', capMs: '3s', jitter: 0 }, 5)).toBe(3000)
  })

  it('ConfigValidationError never throws while rendering a circular or huge value', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(new ConfigValidationError('durability.backend', 'x', circular).message).toContain('config.durability.backend')
    expect(new ConfigValidationError('a', 'x', 'y'.repeat(1000)).message.length).toBeLessThan(400)
  })
})
