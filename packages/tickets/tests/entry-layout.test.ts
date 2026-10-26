/**
 * Entry layout of `@botmesh/tickets` (API freeze before its first public release, see
 * docs/release-readiness.md): the main entry holds what an application needs and is covered
 * by semver; the building blocks live in `/internal` (no semver). The runtime
 * names of each entry are pinned here so that growing one is a deliberate change. Types are
 * checked by `pnpm api-check`.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

/** Every runtime (value) export of the main entry. */
const MAIN_VALUES = ['TICKET_PRIORITIES', 'TICKET_STATUSES', 'TicketContentionError', 'TicketDesk', 'TicketNotFoundError', 'durableKvTicketStorage', 'isWithinWorkingHours', 'memoryTicketStorage', 'parseWorkingHours', 'storeTicketStorage', 'ticketsPlugin'] as const

/** Runtime exports of `/internal` (helpers that are not part of the semver surface). */
const INTERNAL_VALUES = ['localClock', 'renderTemplate'] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/tickets entry layout', () => {
  it('the main entry exports exactly the application values', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES].sort())
  })

  it('/internal exports exactly the building blocks, none of them on the main entry', () => {
    expect(keysOf(internal)).toEqual([...INTERNAL_VALUES].sort())
    for (const name of INTERNAL_VALUES) expect((main as Record<string, unknown>)[name], name).toBeUndefined()
  })

  it('exported data is frozen', () => {
    expect(Object.isFrozen(main.TICKET_PRIORITIES)).toBe(true)
    expect(Object.isFrozen(main.TICKET_STATUSES)).toBe(true)
    expect(() => { (main.TICKET_STATUSES as string[]).push('x') }).toThrow(TypeError)
  })
})
