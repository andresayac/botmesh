import { describe, it, expect } from 'vitest'
import { toEmailError, toEmailProviderError } from '../src/index.js'

describe('error mapper naming', () => {
  it('exports the channel-prefixed toEmailError, with toEmailProviderError as its deprecated alias', () => {
    expect(typeof toEmailError).toBe('function')
    expect(toEmailProviderError).toBe(toEmailError)
  })
})
