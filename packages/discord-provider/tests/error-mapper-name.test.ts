import { describe, it, expect } from 'vitest'
import { toDiscordError, toProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports the channel-prefixed toDiscordError, with toProviderError as its deprecated alias', () => {
    expect(typeof toDiscordError).toBe('function')
    expect(toProviderError).toBe(toDiscordError)
  })
})
