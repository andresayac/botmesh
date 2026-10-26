/**
 * Flow definitions that can never work fail when the flow is DEFINED, not when a user
 * first reaches the step: a `.choose()` without options, an `.ask()` / `.choose()` with an
 * empty state key, and invalid attempt budgets.
 */
import { describe, it, expect } from 'vitest'

import { flow } from '../src/index.js'

describe('flow build-time checks', () => {
  it('choose() with no options throws', () => {
    expect(() => flow('menu').choose('Pick one', {})).toThrow(/choose\(\).*at least one option/)
  })

  it('choose() with a non-object options argument throws', () => {
    expect(() => flow('menu').choose('Pick one', null as unknown as Record<string, string>)).toThrow(TypeError)
    expect(() => flow('menu').choose('Pick one', ['a', 'b'] as unknown as Record<string, string>)).toThrow(TypeError)
  })

  it('an option without a label throws', () => {
    expect(() => flow('menu').choose('Pick one', { a: { label: '' } })).toThrow(/label/)
  })

  it('ask() with an empty state key throws', () => {
    expect(() => flow('f').ask('Name?', '')).toThrow(/state key must not be empty/)
    expect(() => flow('f').ask('Name?', '   ')).toThrow(/state key must not be empty/)
  })

  it('choose() with an empty state key throws', () => {
    expect(() => flow('f').choose('Pick', { a: 'A' }, '')).toThrow(/state key must not be empty/)
  })

  it('invalid attempt budgets throw at definition', () => {
    expect(() => flow('f').ask('Name?', 'name', { maxAttempts: 0 })).toThrow(/maxAttempts/)
    expect(() => flow('f').ask('Name?', 'name', { retries: -1 })).toThrow(/retries/)
    expect(() => flow('f').ask('Name?', 'name', { retries: 1, maxAttempts: 5 })).toThrow(/not both/)
    expect(() => flow('f').choose('Pick', { a: 'A' }, 'pick', { maxAttempts: 1.5 })).toThrow(/maxAttempts/)
    expect(() => flow('f').form({ id: 'x', fields: [{ type: 'text', name: 'a', label: 'A' }] }, { maxAttempts: 0 })).toThrow(/maxAttempts/)
  })

  it('valid definitions still build', () => {
    expect(() => flow('f')
      .ask('Name?', 'name', { maxAttempts: Infinity })
      .choose('Pick', { a: 'A', b: { label: 'B' } }, 'pick', { retries: 0 })
      .compile()).not.toThrow()
  })
})
