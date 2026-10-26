import { describe, it, expect } from 'vitest'
import * as main from '../src/index.js'
import { toDiscordError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports only the channel-prefixed toDiscordError (no toProviderError alias)', () => {
    expect(typeof toDiscordError).toBe('function')
    expect('toProviderError' in main).toBe(false)
  })
})
