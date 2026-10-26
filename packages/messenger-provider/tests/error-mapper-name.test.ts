import { describe, it, expect } from 'vitest'
import { toMessengerError, toProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports the channel-prefixed toMessengerError, with toProviderError as its deprecated alias', () => {
    expect(typeof toMessengerError).toBe('function')
    expect(toProviderError).toBe(toMessengerError)
  })
})
