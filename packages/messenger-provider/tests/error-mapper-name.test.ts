import { describe, it, expect } from 'vitest'
import { OutsideSessionWindowError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import * as main from '../src/index.js'
import { toMessengerError } from '../src/index.js'

describe('error mapper', () => {
  it('exports only the channel-prefixed toMessengerError (no toProviderError alias)', () => {
    expect(typeof toMessengerError).toBe('function')
    expect('toProviderError' in main).toBe(false)
  })

  it('maps Graph errors to the typed provider errors of @botmesh/core', () => {
    const rate = toMessengerError({ code: 613, message: 'calls limit' }, 5_000)
    expect(rate).toBeInstanceOf(RateLimitedError)
    expect((rate as RateLimitedError).retryAfterMs).toBe(5_000)
    const window = toMessengerError({ code: 10, error_subcode: 2018278, message: 'outside window' }, undefined, 'psid-1')
    expect(window).toBeInstanceOf(OutsideSessionWindowError)
    expect(toMessengerError({ code: 551, error_subcode: 1545041, message: 'unavailable' }, undefined, 'psid-1')).toBeInstanceOf(RecipientUnreachableError)
    const other = toMessengerError({ code: 1, message: 'unknown' })
    expect(other).toBeInstanceOf(ProviderError)
    expect(other).not.toBeInstanceOf(RateLimitedError)
  })
})
