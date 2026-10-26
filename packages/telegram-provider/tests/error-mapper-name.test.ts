import { describe, it, expect } from 'vitest'
import { toTelegramError, toProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports the channel-prefixed toTelegramError, with toProviderError as its deprecated alias', () => {
    expect(typeof toTelegramError).toBe('function')
    expect(toProviderError).toBe(toTelegramError)
  })
})
