import { describe, it, expect } from 'vitest'
import { OutsideSessionWindowError, ProviderError, RateLimitedError, RecipientUnreachableError } from '@botmesh/core'
import * as main from '../src/index.js'
import { toInstagramError } from '../src/index.js'

describe('error mapper', () => {
  it('exports only the channel-prefixed toInstagramError (no toProviderError alias)', () => {
    expect(typeof toInstagramError).toBe('function')
    expect('toProviderError' in main).toBe(false)
  })

  it('maps Graph errors to the typed provider errors of @botmesh/core', () => {
    const rate = toInstagramError({ code: 613, message: 'calls limit' }, 5_000)
    expect(rate).toBeInstanceOf(RateLimitedError)
    expect((rate as RateLimitedError).retryAfterMs).toBe(5_000)
    const window = toInstagramError({ code: 10, error_subcode: 2018278, message: 'outside window' }, undefined, 'psid-1')
    expect(window).toBeInstanceOf(OutsideSessionWindowError)
    expect(toInstagramError({ code: 551, error_subcode: 1545041, message: 'unavailable' }, undefined, 'psid-1')).toBeInstanceOf(RecipientUnreachableError)
    const other = toInstagramError({ code: 1, message: 'unknown' })
    expect(other).toBeInstanceOf(ProviderError)
    expect(other).not.toBeInstanceOf(RateLimitedError)
  })
})
