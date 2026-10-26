import { describe, it, expect } from 'vitest'
import { toInstagramError, toProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports the channel-prefixed toInstagramError, with toProviderError as its deprecated alias', () => {
    expect(typeof toInstagramError).toBe('function')
    expect(toProviderError).toBe(toInstagramError)
  })
})
