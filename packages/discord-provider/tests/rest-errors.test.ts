import { describe, expect, it } from 'vitest'
import { PayloadTooLargeError, RateLimitedError } from '@botmesh/core'
import { toProviderError } from '../src/restClient.js'

describe('Discord REST error mapping', () => {
  it('maps JSON code 40005 (request entity too large) to PayloadTooLargeError', () => {
    expect(toProviderError('c1', 400, { code: 40005, message: 'Request entity too large' })).toBeInstanceOf(PayloadTooLargeError)
  })

  it('maps JSON code 40003 (opening direct messages too fast) to RateLimitedError, not PayloadTooLargeError', () => {
    const err = toProviderError('c1', 400, { code: 40003, message: 'You are opening direct messages too fast' })
    expect(err).toBeInstanceOf(RateLimitedError)
  })
})
