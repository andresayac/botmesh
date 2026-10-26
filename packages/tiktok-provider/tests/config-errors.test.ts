import { describe, expect, it } from 'vitest'
import { TikTokProvider } from '../src/TikTokProvider.js'
import type { TikTokProviderConfig } from '../src/types.js'

describe('TikTokProvider — configuration errors are actionable', () => {
  it('requires accessToken (a string or a function), e.g. when the env var is unset', () => {
    const base = { businessId: 'b', appSecret: 's', selfUniqueIdentifier: 'u' }
    expect(() => new TikTokProvider({ ...base, accessToken: undefined } as unknown as TikTokProviderConfig)).toThrow(/requires `accessToken`/)
    expect(() => new TikTokProvider({ ...base, accessToken: '' })).toThrow(/requires `accessToken`/)
    expect(() => new TikTokProvider({ ...base, accessToken: async () => 't' })).not.toThrow()
  })
})
