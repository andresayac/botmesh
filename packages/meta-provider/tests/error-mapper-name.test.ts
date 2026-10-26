import { describe, it, expect } from 'vitest'
import { RateLimitedError } from '@botmesh/core'
import { toGraphError } from '@botmesh/graph-core'
import { toProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('the deprecated toProviderError maps like the shared toGraphError of graph-core', () => {
    const err = { code: 130429, message: 'Rate limit hit' }
    const a = toProviderError('573001', err, 5000)
    const b = toGraphError(err, { chatId: '573001', retryAfterMs: 5000 })
    expect(a).toBeInstanceOf(RateLimitedError)
    expect(a.constructor).toBe(b.constructor)
    expect(a.message).toBe(b.message)
  })
})
