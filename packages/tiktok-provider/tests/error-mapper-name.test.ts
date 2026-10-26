import { describe, it, expect } from 'vitest'
import { toTikTokError, toProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports the channel-prefixed toTikTokError, with toProviderError as its deprecated alias', () => {
    expect(typeof toTikTokError).toBe('function')
    expect(toProviderError).toBe(toTikTokError)
  })
})
