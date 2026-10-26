import { describe, expect, it } from 'vitest'
import { GoHighLevelProvider } from '../src/GoHighLevelProvider.js'

describe('GoHighLevelProvider — configuration errors are actionable', () => {
  it('names the option when publicKey / legacyPublicKey is not a PEM public key', () => {
    expect(() => new GoHighLevelProvider({ accessToken: 't', locationId: 'l', publicKey: 'not a key' }))
      .toThrow(/GoHighLevelProvider: `publicKey` is not a valid PEM public key/)
    expect(() => new GoHighLevelProvider({ accessToken: 't', locationId: 'l', legacyPublicKey: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----' }))
      .toThrow(/`legacyPublicKey` is not a valid PEM public key/)
  })
})
