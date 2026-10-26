/**
 * The moderator's per-user and per-group maps stay bounded on a long-running bot:
 * expired mutes and stale admin lists are swept, and warning counters are capped.
 */
import { describe, expect, it } from 'vitest'
import { Moderator, type ModerationConfig } from '../src/index.js'

const logger = { warn: () => undefined, error: () => undefined, debug: () => undefined }

interface Internals {
  mutes: Map<string, number>
  adminCache: Map<string, unknown>
  warnCounts: Map<string, number>
  isAdmin(chatId: string, userId: string, rules: object): Promise<boolean>
}

function make(config: ModerationConfig = {}) {
  let t = 1_000_000
  const clock = { advance: (ms: number) => { t += ms } }
  const m = new Moderator({ now: () => t, ...config }, logger, async () => undefined)
  return { m, internals: m as unknown as Internals, clock }
}

describe('moderation — bounded in-memory state', () => {
  it('sweeps expired mutes instead of keeping one entry per user ever muted', () => {
    const { m, internals, clock } = make()
    for (let i = 0; i < 25_000; i++) m.mute('g', `u${i}`, 1_000)
    clock.advance(5_000)
    for (let i = 0; i < 25_000; i++) m.mute('g2', `v${i}`, 60_000)
    expect(internals.mutes.size).toBeLessThanOrEqual(25_000)
    expect(m.isMuted('g2', 'v1')).toBe(true)
    expect(m.isMuted('g', 'u1')).toBe(false)
  })

  it('drops stale admin lists of groups not seen for a while', async () => {
    const { internals, clock } = make({
      adminCacheMs: 1_000,
      provider: { groups: { getAdmins: async () => [] } },
    })
    for (let i = 0; i < 12_000; i++) await internals.isAdmin(`g${i}`, 'u', {})
    clock.advance(5_000)
    for (let i = 0; i < 12_000; i++) await internals.isAdmin(`h${i}`, 'u', {})
    expect(internals.adminCache.size).toBeLessThanOrEqual(12_000)
  })

  it('caps warning counters at maxTrackedUsers, evicting the least recently warned', () => {
    const { m, internals } = make({ maxTrackedUsers: 3 })
    const warn = (u: string) => (m as unknown as { bumpWarning(k: string): void }).bumpWarning(`g\u0000${u}`)
    for (const u of ['a', 'b', 'c']) warn(u)
    warn('a') // refresh a
    warn('d') // evicts b, the least recently warned
    expect(internals.warnCounts.size).toBe(3)
    expect(m.warnings('g', 'b')).toBe(0)
    expect(m.warnings('g', 'a')).toBe(2)
    expect(m.warnings('g', 'd')).toBe(1)
  })

  it('rejects a maxTrackedUsers that is not a positive integer', () => {
    expect(() => make({ maxTrackedUsers: 0 })).toThrow(/maxTrackedUsers/)
    expect(() => make({ maxTrackedUsers: Number.NaN })).toThrow(/maxTrackedUsers/)
  })
})
